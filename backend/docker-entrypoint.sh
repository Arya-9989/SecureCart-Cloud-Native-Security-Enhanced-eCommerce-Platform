#!/bin/sh
# Container entrypoint: optional one-off setup steps, then hand over to the CMD.
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    # Convenient for single-instance deployments. With several replicas, run migrations
    # as a separate release job instead and set RUN_MIGRATIONS=false here.
    python manage.py migrate --noinput
    python manage.py createcachetable
fi

if [ "${SEED_DEMO:-false}" = "true" ]; then
    python manage.py seed_demo
fi

exec "$@"
