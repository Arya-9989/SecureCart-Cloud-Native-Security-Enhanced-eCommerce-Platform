# syntax=docker/dockerfile:1.7

# ---- uv binary ----------------------------------------------------------------------
FROM ghcr.io/astral-sh/uv:0.13.5 AS uv

# ---- build: resolve the locked dependency set into a self-contained virtualenv -------
FROM python:3.12.15-slim AS builder
COPY --from=uv /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY . .
# Static assets (Swagger/ReDoc bundles) are collected at build time; the key is a dummy.
RUN DJANGO_SECRET_KEY=collectstatic-only DJANGO_DEBUG=false \
    /opt/venv/bin/python manage.py collectstatic --noinput --verbosity 0

# ---- runtime: slim, non-root, no build tooling ---------------------------------------
FROM python:3.12.15-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
COPY --from=builder --chown=root:root /app /app
RUN chmod 0755 /app/docker-entrypoint.sh
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health/', timeout=4).status == 200 else 1)"]
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "3", \
     "--worker-tmp-dir", "/tmp", \
     "--no-control-socket", \
     "--access-logfile", "-", \
     "--forwarded-allow-ips", "*"]
