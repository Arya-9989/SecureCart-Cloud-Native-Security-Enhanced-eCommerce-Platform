from rest_framework import serializers

from apps.audit.models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer[AuditLog]):
    class Meta:
        model = AuditLog
        fields = [
            "id",
            "actor_email",
            "action",
            "target_type",
            "target_id",
            "target_repr",
            "changes",
            "ip_address",
            "request_id",
            "created_at",
        ]
        read_only_fields = fields
