"""The multi-instance-safe scheduler and its jobs."""

from __future__ import annotations

import threading
from datetime import timedelta
from io import StringIO
from pathlib import Path
from typing import Any

import pytest
from django.core.management import call_command
from django.db import connection, connections
from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts import onetime, tokens
from apps.accounts.models import OneTimeToken, TokenPurpose, User
from apps.core import jobs
from apps.core.models import JobLock
from apps.core.scheduler import Job, Scheduler, acquire, release
from apps.orders.models import Order, OrderStatus
from apps.payments.models import WebhookEvent
from tests.conftest import add_to_cart, checkout

pytestmark = pytest.mark.django_db

MINUTE = timedelta(minutes=1)


class TestLease:
    def test_only_one_instance_holds_the_lease(self) -> None:
        assert acquire("job", MINUTE, owner="a")
        assert not acquire("job", MINUTE, owner="b")
        assert JobLock.objects.get(name="job").locked_by == "a"

    def test_release_keeps_the_lease_for_the_rest_of_the_interval(self) -> None:
        assert acquire("job", MINUTE, owner="a")
        release("job", lock_at_least_for=MINUTE, owner="a")
        assert not acquire("job", MINUTE, owner="b")  # same interval: skip

    def test_lease_lapses_after_the_interval(self) -> None:
        assert acquire("job", MINUTE, owner="a")
        release("job", lock_at_least_for=timedelta(0), owner="a")
        assert acquire("job", MINUTE, owner="b")

    def test_a_crashed_holder_cannot_wedge_the_job(self) -> None:
        assert acquire("job", MINUTE, owner="dead")
        # The holder died without releasing; time passes beyond lock_at_most_for.
        JobLock.objects.filter(name="job").update(locked_until=timezone.now() - MINUTE)
        assert acquire("job", MINUTE, owner="alive")

    def test_only_the_holder_can_release(self) -> None:
        assert acquire("job", MINUTE, owner="a")
        release("job", lock_at_least_for=timedelta(0), owner="intruder")
        assert not acquire("job", MINUTE, owner="b")


class TestJobRunner:
    def test_runs_once_per_interval_across_instances(self) -> None:
        calls: list[str] = []
        job = Job("count", every=MINUTE, run=lambda: calls.append("ran"))
        assert job.run_if_due(owner="a")
        assert not job.run_if_due(owner="b")
        assert not job.run_if_due(owner="a")
        assert calls == ["ran"]

    def test_failing_job_releases_its_lease_and_the_loop_survives(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        def boom() -> None:
            raise RuntimeError("job failed")

        failing = Job("boom", every=timedelta(seconds=1), run=boom)
        ok_calls: list[int] = []
        ok = Job("ok", every=MINUTE, run=lambda: ok_calls.append(1))
        ran = Scheduler([failing, ok], tick_seconds=0).tick()
        assert ran == ["boom", "ok"]
        assert ok_calls == [1]
        assert "job=boom" in caplog.text
        lease = JobLock.objects.get(name="boom")
        assert lease.locked_until <= timezone.now() + timedelta(seconds=1)

    def test_heartbeat_is_written_every_tick(self, tmp_path: Path) -> None:
        beat = tmp_path / "beat"
        Scheduler([], heartbeat=beat).tick()
        assert beat.read_text().isdigit()

    def test_stop_ends_the_loop(self) -> None:
        loop = Scheduler([], tick_seconds=60)
        worker = threading.Thread(target=loop.run_forever)
        worker.start()
        loop.stop()
        worker.join(timeout=5)
        assert not worker.is_alive()

    def test_command_runs_a_single_tick(self, tmp_path: Path) -> None:
        out = StringIO()
        call_command("run_scheduler", "--once", "--heartbeat", str(tmp_path / "hb"), stdout=out)
        assert "settle_pending_orders" in out.getvalue()
        assert "purge_expired_records" in out.getvalue()
        out = StringIO()
        call_command("run_scheduler", "--once", "--heartbeat", str(tmp_path / "hb"), stdout=out)
        assert "nothing due" in out.getvalue()


class TestJobs:
    def test_settles_abandoned_orders(
        self, customer_api: Any, customer: User, product: Any, settings: Any
    ) -> None:
        add_to_cart(customer, product, 2)
        order = Order.objects.get(pk=checkout(customer_api).data["id"])
        Order.objects.filter(pk=order.pk).update(
            status=OrderStatus.PENDING_PAYMENT,
            created_at=timezone.now()
            - timedelta(minutes=settings.PENDING_ORDER_TIMEOUT_MINUTES + 1),
        )
        assert jobs.settle_pending_orders()["expired"] == 1
        order.refresh_from_db()
        assert order.status == OrderStatus.CANCELLED

    def test_purges_only_records_that_can_no_longer_matter(self, customer: User) -> None:
        live = onetime.issue(customer, TokenPurpose.VERIFY_EMAIL)
        old = OneTimeToken.objects.create(
            user=customer,
            purpose=TokenPurpose.RESET_PASSWORD,
            token_hash="0" * 64,
            email=customer.email,
            expires_at=timezone.now() - timedelta(days=2),
        )
        recent_event = WebhookEvent.objects.create(
            provider="stripe", event_id="evt_new", event_type="x"
        )
        stale_event = WebhookEvent.objects.create(
            provider="stripe", event_id="evt_old", event_type="x"
        )
        WebhookEvent.objects.filter(pk=stale_event.pk).update(
            received_at=timezone.now() - timedelta(days=31)
        )
        tokens.issue_tokens(customer)
        expired = tokens.issue_tokens(customer)
        OutstandingToken.objects.filter(jti=RefreshToken(expired.refresh)["jti"]).update(  # type: ignore[arg-type]
            expires_at=timezone.now() - MINUTE
        )

        counts = jobs.purge_expired_records()
        assert counts["one_time_tokens"] == 1
        assert counts["webhook_events"] == 1
        assert counts["refresh_tokens"] >= 1
        assert not OneTimeToken.objects.filter(pk=old.pk).exists()
        assert OneTimeToken.objects.filter(token_hash=onetime.hash_secret(live)).exists()
        assert WebhookEvent.objects.filter(pk=recent_event.pk).exists()
        assert OutstandingToken.objects.filter(user=customer).count() == 1


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_racing_instances_run_a_job_exactly_once() -> None:
    """Eight scheduler instances tick at the same instant: the job runs once."""
    if connection.vendor != "postgresql":
        pytest.skip("needs real concurrent transactions")
    runs: list[str] = []
    lock = threading.Lock()

    def work() -> None:
        with lock:
            runs.append("ran")

    job = Job("race", every=MINUTE, run=work)
    barrier = threading.Barrier(8)
    results: list[bool] = []

    def instance(n: int) -> None:
        try:
            barrier.wait()
            results.append(job.run_if_due(owner=f"instance-{n}"))
        finally:
            connections.close_all()

    threads = [threading.Thread(target=instance, args=(n,)) for n in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert runs == ["ran"]
    assert sorted(results) == [False] * 7 + [True]
    assert JobLock.objects.count() == 1
