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

# Throttling state must be shared by every worker process, so production uses the
# database cache (created by ``manage.py createcachetable``). LocMem is fine for dev/tests.
_cache_backend = env_str("DJANGO_CACHE_BACKEND", "locmem")
if _cache_backend == "db":
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.db.DatabaseCache",
            "LOCATION": "django_cache",
        }
    }
elif _cache_backend == "locmem":
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
else:
    raise ImproperlyConfigured("DJANGO_CACHE_BACKEND must be 'locmem' or 'db'.")

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
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": env_str("THROTTLE_ANON", "120/min"),
        "user": env_str("THROTTLE_USER", "600/min"),
        "auth": env_str("THROTTLE_AUTH", "10/min"),
        "auth_refresh": env_str("THROTTLE_AUTH_REFRESH", "60/min"),
        "checkout": env_str("THROTTLE_CHECKOUT", "20/min"),
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
STORE_CURRENCY = env_str("STORE_CURRENCY", "USD")
FREE_SHIPPING_THRESHOLD = env_str("FREE_SHIPPING_THRESHOLD", "75.00")
FLAT_SHIPPING_FEE = env_str("FLAT_SHIPPING_FEE", "6.99")
TAX_RATE = env_str("TAX_RATE", "0.08")
MAX_CART_LINE_QUANTITY = env_int("MAX_CART_LINE_QUANTITY", 10)

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
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"},
    },
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "default"}},
    "root": {"handlers": ["console"], "level": LOG_LEVEL},
    "loggers": {
        "django.request": {"level": "WARNING"},
        "securecart": {"level": LOG_LEVEL, "propagate": True},
    },
}
