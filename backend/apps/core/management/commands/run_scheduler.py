"""Run the periodic jobs (pending-order settlement, data hygiene) until SIGTERM.

Start one per deployment or several for availability: each job runs once per interval
across all of them (see apps.core.scheduler). ``--once`` runs a single tick and exits.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand

from apps.core.jobs import default_jobs
from apps.core.scheduler import Scheduler


class Command(BaseCommand):
    help = "Run scheduled jobs; safe to run on several instances at once."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--once", action="store_true", help="Run one tick and exit.")
        parser.add_argument("--tick", type=float, default=15.0, help="Seconds between ticks.")
        parser.add_argument(
            "--heartbeat",
            default="/tmp/scheduler-heartbeat",  # noqa: S108 - tmpfs in the container
            help="File touched after every tick (used by the health check).",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        scheduler = Scheduler(
            default_jobs(), tick_seconds=options["tick"], heartbeat=Path(options["heartbeat"])
        )
        if options["once"]:
            ran = scheduler.tick()
            self.stdout.write(f"Ran: {', '.join(ran) or 'nothing due'}")
            return
        scheduler.install_signal_handlers()
        scheduler.run_forever()
