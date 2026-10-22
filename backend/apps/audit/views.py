import django_filters
from rest_framework import mixins, viewsets

from apps.accounts.permissions import IsAdminRole
from apps.audit.models import AuditLog
from apps.audit.serializers import AuditLogSerializer


class AuditLogFilter(django_filters.FilterSet):
    action = django_filters.CharFilter(field_name="action", lookup_expr="startswith")
    actor = django_filters.CharFilter(field_name="actor_email", lookup_expr="icontains")

    class Meta:
        model = AuditLog
        fields = ["action", "actor", "target_type"]


class AuditLogViewSet(mixins.ListModelMixin, viewsets.GenericViewSet[AuditLog]):
    """Read-only audit trail for administrators."""

    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    permission_classes = [IsAdminRole]
    filterset_class = AuditLogFilter
