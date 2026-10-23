"""Settings for the pytest suite: deterministic, fast, and safe to run anywhere."""

import os

os.environ.setdefault("DJANGO_SECRET_KEY", "test-secret-key-not-for-production-use-0123456789")
os.environ.setdefault("REFRESH_COOKIE_SECURE", "true")

from config.settings import *  # noqa: F403

# Fast hashing in tests only; production uses Argon2 (see settings.PASSWORD_HASHERS).
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
# Redis-backed tests opt in explicitly (tests/test_cache_and_throttling.py reads REDIS_URL),
# so shared limiter state can never leak between unrelated tests.
REDIS_URL = ""
MIDDLEWARE = [m for m in MIDDLEWARE if "whitenoise" not in m]  # noqa: F405
STORAGES = {"staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}}
REST_FRAMEWORK = {
    **REST_FRAMEWORK,  # noqa: F405
    "DEFAULT_THROTTLE_RATES": {
        "anon": "10000/min",
        "user": "10000/min",
        "auth": "10000/min",
        "auth_refresh": "10000/min",
        "checkout": "10000/min",
        "account_email": "10000/min",
        "account_email_recipient": "10000/min",
        "account_data": "10000/min",
    },
}
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
EMAIL_DELIVERY = "inline"
EMAIL_RETRY_BACKOFF_SECONDS = 0
ACCOUNT_RECOVERY_MIN_RESPONSE_MS = 0
