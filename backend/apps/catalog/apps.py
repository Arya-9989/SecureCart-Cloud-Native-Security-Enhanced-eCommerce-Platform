from django.apps import AppConfig


class CatalogConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.catalog"
    label = "catalog"

    def ready(self) -> None:
        from apps.catalog import signals  # noqa: PLC0415 - models must be loaded first

        signals.connect()
