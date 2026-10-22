from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.accounts"
    label = "accounts"

    def ready(self) -> None:
        # Registers the OpenAPI extension for SessionJWTAuthentication.
        from apps.accounts import schema  # noqa: F401, PLC0415
