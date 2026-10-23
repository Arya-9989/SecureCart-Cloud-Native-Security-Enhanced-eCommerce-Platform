"""Invalidate the catalog cache whenever a product or category changes."""

from __future__ import annotations

from typing import Any

from django.db.models.signals import post_delete, post_save

from apps.catalog import cache as catalog_cache
from apps.catalog.models import Category, Product


def _changed(sender: Any, **kwargs: Any) -> None:
    catalog_cache.bump_after_commit()


def connect() -> None:
    for model in (Product, Category):
        post_save.connect(_changed, sender=model, dispatch_uid=f"catalog-cache-save-{model}")
        post_delete.connect(_changed, sender=model, dispatch_uid=f"catalog-cache-del-{model}")
