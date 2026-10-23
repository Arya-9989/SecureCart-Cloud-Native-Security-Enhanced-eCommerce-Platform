"""Django settings for SecureCart.

Every deploy-specific value comes from environment variables (see ``.env.example``).
Defaults are *secure* defaults: DEBUG is off, cookies are Secure, and a secret key is
mandatory unless DEBUG is explicitly enabled for local development.
"""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import Any

from django.core.exceptions import ImproperlyConfigured

from config.env import env_bool, env_int, env_list, env_str, parse_database_url

BASE_DIR = Path(__file__).resolve().parent.parent

# --------------------------------------------------------------------------------------
# Core
# --------------------------------------------------------------------------------------
DEBUG = env_bool("DJANGO_DEBUG", default=False)

_secret_key = env_str("DJANGO_SECRET_KEY", "")
if not _secret_key:
    if not DEBUG:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is false.")
    _secret_key = "insecure-dev-only-key-do-not-use-in-production"  # noqa: S105
SECRET_KEY = _secret_key

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", "")

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "drf_spectacular",
    "drf_spectacular_sidecar",
    "apps.core",
    "apps.accounts",
    "apps.catalog",
    "apps.cart",
    "apps.orders",
    "apps.payments",
    "apps.audit",
    "apps.dashboard",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "apps.core.middleware.SecurityHeadersMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "apps.core.middleware.RequestIDMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": ["django.template.context_processors.request"]},
    }
]

# --------------------------------------------------------------------------------------
# Database & cache
# --------------------------------------------------------------------------------------
DATABASES = {
    "default": parse_database_url(
        env_str("DATABASE_URL", f"sqlite:///{(BASE_DIR / 'db.sqlite3').as_posix()}")
    )
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Shared state (throttle windows, the catalog cache) must be visible to every worker and every
# replica. Production uses Redis: rate limits are enforced atomically there (see
# apps.core.ratelimit). "db" and "locmem" remain for single-host and development setups.
REDIS_URL = env_str("REDIS_URL", "")
REDIS_TIMEOUT_SECONDS = float(env_str("REDIS_TIMEOUT_SECONDS", "0.5"))
_cache_backend = env_str("DJANGO_CACHE_BACKEND", "redis" if REDIS_URL else "locmem")
if _cache_backend == "redis":
    if not REDIS_URL:
        raise ImproperlyConfigured("DJANGO_CACHE_BACKEND=redis needs REDIS_URL.")
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": REDIS_URL,
            "KEY_PREFIX": "securecart",
            "OPTIONS": {
                "socket_connect_timeout": REDIS_TIMEOUT_SECONDS,
                "socket_timeout": REDIS_TIMEOUT_SECONDS,
            },
        }
    }
elif _cache_backend == "db":
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.db.DatabaseCache",
            "LOCATION": "django_cache",
        }
    }
elif _cache_backend == "locmem":
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
else:
    raise ImproperlyConfigured("DJANGO_CACHE_BACKEND must be 'redis', 'db' or 'locmem'.")
#: Seconds a cached catalog response may live; writes invalidate it sooner (catalog.cache).
CATALOG_CACHE_SECONDS = env_int("CATALOG_CACHE_SECONDS", 300)

# --------------------------------------------------------------------------------------
# Auth & passwords
# --------------------------------------------------------------------------------------
AUTH_USER_MODEL = "accounts.User"
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --------------------------------------------------------------------------------------
# REST framework / OpenAPI
# --------------------------------------------------------------------------------------
REST_FRAMEWORK: dict[str, Any] = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.accounts.authentication.SessionJWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": [
        "apps.core.throttling.AnonRateThrottle",
        "apps.core.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": env_str("THROTTLE_ANON", "120/min"),
        "user": env_str("THROTTLE_USER", "600/min"),
        "auth": env_str("THROTTLE_AUTH", "10/min"),
        "auth_refresh": env_str("THROTTLE_AUTH_REFRESH", "60/min"),
        "checkout": env_str("THROTTLE_CHECKOUT", "20/min"),
        # Mail-sending endpoints: per client IP, plus a silent per-recipient budget so nobody
        # can flood someone else's inbox (see apps.accounts.throttles).
        "account_email": env_str("THROTTLE_ACCOUNT_EMAIL", "5/min"),
        "account_email_recipient": env_str("THROTTLE_ACCOUNT_EMAIL_RECIPIENT", "3/hour"),
        "account_data": env_str("THROTTLE_ACCOUNT_DATA", "10/hour"),
    },
    "NUM_PROXIES": env_int("NUM_PROXIES", 0),
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "SecureCart API",
    "DESCRIPTION": (
        "REST API for the SecureCart e-commerce platform. Authenticate with "
        "`POST /api/auth/login/`, then send `Authorization: Bearer <access>`."
    ),
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SWAGGER_UI_DIST": "SIDECAR",
    "SWAGGER_UI_FAVICON_HREF": "SIDECAR",
    "REDOC_DIST": "SIDECAR",
    "COMPONENT_SPLIT_REQUEST": True,
    "ENUM_NAME_OVERRIDES": {
        "OrderStatusEnum": "apps.orders.models.OrderStatus",
        "RoleEnum": "apps.accounts.models.Role",
    },
}

SIMPLE_JWT: dict[str, Any] = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env_int("JWT_ACCESS_MINUTES", 10)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env_int("JWT_REFRESH_DAYS", 7)),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": env_str("JWT_SIGNING_KEY", "") or SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "LEEWAY": 5,
}

# The refresh token never touches JavaScript: it lives in an httpOnly cookie that is only
# sent to the auth endpoints. The short-lived access token is kept in memory by the SPA.
REFRESH_COOKIE: dict[str, Any] = {
    "NAME": env_str("REFRESH_COOKIE_NAME", "securecart_refresh"),
    "PATH": "/api/auth/",
    "SECURE": env_bool("REFRESH_COOKIE_SECURE", default=True),
    "SAMESITE": "Strict",
    "HTTPONLY": True,
}

# --------------------------------------------------------------------------------------
# Email (verification and password reset)
# --------------------------------------------------------------------------------------
# SMTP by default. Compose points it at Mailpit, which catches every message locally.
# "console" prints messages (and therefore their one-time links) to the log: development only.
_email_backends = {
    "smtp": "django.core.mail.backends.smtp.EmailBackend",
    "console": "django.core.mail.backends.console.EmailBackend",
    "locmem": "django.core.mail.backends.locmem.EmailBackend",
}
_email_backend = env_str("EMAIL_BACKEND", "console" if DEBUG else "smtp")
if _email_backend not in _email_backends:
    raise ImproperlyConfigured(f"EMAIL_BACKEND must be one of {sorted(_email_backends)}.")
if _email_backend == "console" and not DEBUG:
    raise ImproperlyConfigured("EMAIL_BACKEND=console would log reset links; use it with DEBUG.")
EMAIL_BACKEND = _email_backends[_email_backend]
EMAIL_HOST = env_str("EMAIL_HOST", "localhost")
EMAIL_PORT = env_int("EMAIL_PORT", 587)
EMAIL_HOST_USER = env_str("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = env_str("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", default=EMAIL_PORT == 587)
EMAIL_USE_SSL = env_bool("EMAIL_USE_SSL", default=EMAIL_PORT == 465)
if EMAIL_USE_TLS and EMAIL_USE_SSL:
    raise ImproperlyConfigured("Set at most one of EMAIL_USE_TLS and EMAIL_USE_SSL.")
EMAIL_TIMEOUT = env_int("EMAIL_TIMEOUT_SECONDS", 10)
DEFAULT_FROM_EMAIL = env_str("DEFAULT_FROM_EMAIL", "SecureCart <no-reply@securecart.dev>")
#: "background" sends after commit on a worker thread; "inline" sends after commit in-request.
EMAIL_DELIVERY = env_str("EMAIL_DELIVERY", "background")
if EMAIL_DELIVERY not in {"background", "inline"}:
    raise ImproperlyConfigured("EMAIL_DELIVERY must be 'background' or 'inline'.")
EMAIL_SEND_ATTEMPTS = env_int("EMAIL_SEND_ATTEMPTS", 3)
EMAIL_RETRY_BACKOFF_SECONDS = env_int("EMAIL_RETRY_BACKOFF_SECONDS", 2)
#: Public origin of the storefront, used to build the links in emails.
APP_BASE_URL = env_str("APP_BASE_URL", "http://localhost:8080")
EMAIL_VERIFICATION_TTL_HOURS = env_int("EMAIL_VERIFICATION_TTL_HOURS", 24)
PASSWORD_RESET_TTL_MINUTES = env_int("PASSWORD_RESET_TTL_MINUTES", 30)
#: Checkout requires a confirmed address, so orders are tied to a reachable inbox.
REQUIRE_VERIFIED_EMAIL = env_bool("REQUIRE_VERIFIED_EMAIL", default=True)
#: Account-recovery responses never return sooner than this, whether or not the account
#: exists, so response time cannot reveal which addresses are registered.
ACCOUNT_RECOVERY_MIN_RESPONSE_MS = env_int("ACCOUNT_RECOVERY_MIN_RESPONSE_MS", 400)

# --------------------------------------------------------------------------------------
# Security headers
# --------------------------------------------------------------------------------------
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", default=False)
SECURE_HSTS_SECONDS = env_int("DJANGO_HSTS_SECONDS", 0)
SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0
SECURE_HSTS_PRELOAD = False
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_HTTPONLY = True
if env_bool("DJANGO_BEHIND_TLS_PROXY", default=False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Restrictive CSP for anything Django renders (API docs). The SPA's CSP is set by nginx.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'; "
    "base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
)
PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(self)"

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "")
CORS_ALLOW_CREDENTIALS = True
CORS_URLS_REGEX = r"^/api/.*$"

DATA_UPLOAD_MAX_MEMORY_SIZE = 1024 * 1024  # 1 MiB: the API only accepts small JSON bodies

# --------------------------------------------------------------------------------------
# Domain configuration
# --------------------------------------------------------------------------------------
PAYMENT_PROVIDER = env_str("PAYMENT_PROVIDER", "apps.payments.providers.mock.MockPaymentProvider")
# Stripe (only read when PAYMENT_PROVIDER is the Stripe provider). Test mode by default:
# live keys are refused unless STRIPE_ALLOW_LIVE_MODE is set. See ADR 0003.
STRIPE_SECRET_KEY = env_str("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = env_str("STRIPE_WEBHOOK_SECRET", "")
STRIPE_API_BASE = env_str("STRIPE_API_BASE", "https://api.stripe.com")
STRIPE_TIMEOUT_SECONDS = env_int("STRIPE_TIMEOUT_SECONDS", 10)
STRIPE_MAX_NETWORK_RETRIES = env_int("STRIPE_MAX_NETWORK_RETRIES", 2)
#: Signed webhooks older than this are rejected as replays (Stripe's own default is 300).
STRIPE_WEBHOOK_TOLERANCE_SECONDS = env_int("STRIPE_WEBHOOK_TOLERANCE_SECONDS", 300)
STRIPE_ALLOW_LIVE_MODE = env_bool("STRIPE_ALLOW_LIVE_MODE", default=False)
STORE_CURRENCY = env_str("STORE_CURRENCY", "USD")
FREE_SHIPPING_THRESHOLD = env_str("FREE_SHIPPING_THRESHOLD", "75.00")
FLAT_SHIPPING_FEE = env_str("FLAT_SHIPPING_FEE", "6.99")
TAX_RATE = env_str("TAX_RATE", "0.08")
MAX_CART_LINE_QUANTITY = env_int("MAX_CART_LINE_QUANTITY", 10)
# Seller details printed on invoices (apps.orders.invoice).
STORE_NAME = env_str("STORE_NAME", "SecureCart")
# Lines are separated by "|" so the value fits on one line of a .env file.
STORE_ADDRESS = env_str(
    "STORE_ADDRESS", "1 Example Street|San Francisco, CA 94105|United States"
).replace("|", "\n")
INVOICE_FOOTER = env_str(
    "INVOICE_FOOTER",
    "SecureCart is a portfolio demonstration store: no goods are shipped and no real money moves.",
)

# Product images (apps.catalog.media). "s3" for MinIO/S3, "memory" for tests, or "disabled".
MEDIA_STORAGE = env_str("MEDIA_STORAGE", "disabled")
MEDIA_S3_ENDPOINT = env_str("MEDIA_S3_ENDPOINT", "")  # empty means AWS S3 itself
MEDIA_S3_BUCKET = env_str("MEDIA_S3_BUCKET", "securecart-media")
MEDIA_S3_REGION = env_str("MEDIA_S3_REGION", "us-east-1")
MEDIA_S3_ACCESS_KEY = env_str("MEDIA_S3_ACCESS_KEY", "")
MEDIA_S3_SECRET_KEY = env_str("MEDIA_S3_SECRET_KEY", "")
MAX_IMAGE_UPLOAD_BYTES = env_int("MAX_IMAGE_UPLOAD_BYTES", 5 * 1024 * 1024)
MAX_IMAGE_PIXELS = env_int("MAX_IMAGE_PIXELS", 40_000_000)
MAX_IMAGE_EDGE = env_int("MAX_IMAGE_EDGE", 2000)
#: Unpaid orders older than this are settled by the scheduler (stock released or reconciled).
PENDING_ORDER_TIMEOUT_MINUTES = env_int("PENDING_ORDER_TIMEOUT_MINUTES", 30)
SCHEDULER_PENDING_ORDERS_EVERY_SECONDS = env_int("SCHEDULER_PENDING_ORDERS_EVERY_SECONDS", 300)

# --------------------------------------------------------------------------------------
# i18n, static files, logging
# --------------------------------------------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "staticfiles": {
        "BACKEND": (
            "django.contrib.staticfiles.storage.StaticFilesStorage"
            if DEBUG
            else "whitenoise.storage.CompressedManifestStaticFilesStorage"
        )
    }
}

LOG_LEVEL = env_str("LOG_LEVEL", "INFO")
#: "json" (one object per line, with request IDs) or "text". JSON unless DEBUG is on.
LOG_FORMAT = env_str("LOG_FORMAT", "text" if DEBUG else "json")
if LOG_FORMAT not in {"json", "text"}:
    raise ImproperlyConfigured("LOG_FORMAT must be 'json' or 'text'.")
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {"request_id": {"()": "apps.core.logging.RequestIDFilter"}},
    "formatters": {
        "text": {"format": "%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s"},
        "json": {"()": "apps.core.logging.JsonFormatter"},
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": LOG_FORMAT,
            "filters": ["request_id"],
        }
    },
    "root": {"handlers": ["console"], "level": LOG_LEVEL},
    "loggers": {
        "django.request": {"level": "WARNING"},
        "securecart": {"level": LOG_LEVEL, "propagate": True},
    },
}
