from __future__ import annotations

from django.db import models


class JobLock(models.Model):
    """Lease row for one scheduled job (the ShedLock pattern, see apps.core.scheduler).

    ``locked_until`` is the lease end: a holder that dies stops renewing nothing and the lease
    simply lapses, so a crashed instance can never wedge the job.
    """

    name = models.CharField(primary_key=True, max_length=64)
    locked_until = models.DateTimeField()
    locked_at = models.DateTimeField()
    locked_by = models.CharField(max_length=255)

    def __str__(self) -> str:
        return f"{self.name} until {self.locked_until:%H:%M:%S} by {self.locked_by}"
