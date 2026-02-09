#!/bin/sh
set -e

if [ "$(id -u)" = "0" ]; then
    mkdir -p /app/backend/data

    chown -R nodejs:nodejs /app/backend/data

    exec su-exec nodejs:nodejs "$@"
fi

exec "$@"
