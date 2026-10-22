"""A small in-process scheduler that is safe to run on any number of instances.

Each job is guarded by a lease in the database (the ShedLock pattern):

- **Acquire** is one conditional ``UPDATE ... SET locked_until = now + lock_at_most_for
  WHERE name = ? AND locked_until <= now``. The database applies it atomically, so of N
  instances ticking at the same moment exactly one gets ``rowcount == 1``.
- **Release** shortens the lease to ``max(now, started + lock_at_least_for)``, not to now.
  An instance whose clock ticks a few seconds later therefore cannot run the job a second
  time in the same interval.
- **Crash safety.** A holder that dies mid-run leaves a lease that lapses after
  ``lock_at_most_for``. Nothing wedges, and no heartbeat or Redis is needed.
- Jobs must still be idempotent: a job that outlives ``lock_at_most_for`` could overlap the
  next run. Every job here goes through the order state machine's row locks, so an overlap
  is harmless.

The database, not Redis, holds the leases, because the jobs act on database rows anyway:
one dependency, transactional, and present in every deployment.
"""

from __future__ import annotations

import logging
import os
import signal
import socket
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from types import FrameType
from typing import Any

from django.db import IntegrityError, close_old_connections, transaction
from django.utils import timezone

from apps.core.models import JobLock

logger = logging.getLogger("securecart.scheduler")

INSTANCE = f"{socket.gethostname()}:{os.getpid()}"


def acquire(name: str, lock_at_most_for: timedelta, owner: str = INSTANCE) -> bool:
    now = timezone.now()
    until = now + lock_at_most_for
    updated = JobLock.objects.filter(name=name, locked_until__lte=now).update(
        locked_until=until, locked_at=now, locked_by=owner
    )
    if updated:
        return True
    try:
        with transaction.atomic():
            JobLock.objects.create(name=name, locked_until=until, locked_at=now, locked_by=owner)
    except IntegrityError:
        return False  # another instance holds it (or created it a moment ago)
    return True


def release(name: str, lock_at_least_for: timedelta, owner: str = INSTANCE) -> None:
    lock = JobLock.objects.filter(name=name, locked_by=owner).first()
    if lock is None:
        return
    until = max(timezone.now(), lock.locked_at + lock_at_least_for)
    JobLock.objects.filter(name=name, locked_by=owner, locked_at=lock.locked_at).update(
        locked_until=until
    )


@dataclass(frozen=True)
class Job:
    name: str
    every: timedelta
    run: Callable[[], Any]
    #: Longest a run may hold the lease; after this a crashed holder's lease lapses.
    lock_at_most_for: timedelta = timedelta(minutes=10)

    def run_if_due(self, owner: str = INSTANCE) -> bool:
        """Run once if this instance wins the lease. Returns whether it ran."""
        if not acquire(self.name, self.lock_at_most_for, owner):
            return False
        started = time.monotonic()
        try:
            result = self.run()
            logger.info(
                "job=%s owner=%s result=%s took=%.2fs",
                self.name,
                owner,
                result,
                time.monotonic() - started,
            )
        except Exception:
            logger.exception("job=%s owner=%s failed", self.name, owner)
        finally:
            # Hold the lease for the rest of the interval so other instances skip this tick.
            release(self.name, self.every - timedelta(seconds=1), owner)
        return True


class Scheduler:
    def __init__(
        self, jobs: list[Job], tick_seconds: float = 15, heartbeat: Path | None = None
    ) -> None:
        self.jobs = jobs
        self.tick_seconds = tick_seconds
        self.heartbeat = heartbeat
        self.stopping = threading.Event()

    def stop(self, signum: int | None = None, frame: FrameType | None = None) -> None:
        logger.info("scheduler stopping (signal %s)", signum)
        self.stopping.set()

    def install_signal_handlers(self) -> None:
        signal.signal(signal.SIGTERM, self.stop)
        signal.signal(signal.SIGINT, self.stop)

    def tick(self) -> list[str]:
        ran = []
        for job in self.jobs:
            if self.stopping.is_set():
                break
            try:
                if job.run_if_due():
                    ran.append(job.name)
            except Exception:  # a database blip must not kill the loop
                logger.exception("scheduler could not run job=%s", job.name)
        if self.heartbeat is not None:
            self.heartbeat.write_text(str(int(time.time())))
        return ran

    def run_forever(self) -> None:
        logger.info("scheduler started instance=%s jobs=%s", INSTANCE, [j.name for j in self.jobs])
        while not self.stopping.is_set():
            # A long-lived process must not keep a connection the database already dropped.
            close_old_connections()
            self.tick()
            self.stopping.wait(self.tick_seconds)
        logger.info("scheduler stopped")
