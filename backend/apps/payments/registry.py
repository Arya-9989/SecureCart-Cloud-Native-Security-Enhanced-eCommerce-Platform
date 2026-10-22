from __future__ import annotations

from functools import cache

from django.conf import settings
from django.utils.module_loading import import_string

from apps.payments.providers.base import PaymentProvider


@cache
def _load(path: str) -> PaymentProvider:
    provider_cls = import_string(path)
    if not (isinstance(provider_cls, type) and issubclass(provider_cls, PaymentProvider)):
        raise TypeError(f"{path} is not a PaymentProvider subclass.")
    return provider_cls()


def get_payment_provider() -> PaymentProvider:
    return _load(settings.PAYMENT_PROVIDER)
