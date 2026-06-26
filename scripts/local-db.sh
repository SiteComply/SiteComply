#!/usr/bin/env bash
#
# Local PostgreSQL helper for SiteComply development ONLY.
#
# This spins up a throwaway, userland PostgreSQL 16 instance (no root, no
# Docker) so migrations and the seed can run on a machine without a system
# Postgres. Production uses Azure Database for PostgreSQL Flexible Server — this
# script is never used there.
#
# Usage:
#   scripts/local-db.sh init     # one-time: create the data directory + database
#   scripts/local-db.sh start    # start the server (port 5432)
#   scripts/local-db.sh stop     # stop the server
#   scripts/local-db.sh status   # show server status
#   scripts/local-db.sh psql     # open a psql shell on the sitecomply database
#
# Override the install location / port with environment variables:
#   PG_PREFIX (default: $HOME/.local/pgsql)   PG_PORT (default: 5432)
#
set -euo pipefail

PG_PREFIX="${PG_PREFIX:-$HOME/.local/pgsql}"
PG_PORT="${PG_PORT:-5432}"
PGBIN="$PG_PREFIX/usr/lib/postgresql/16/bin"
PGDATA="$PG_PREFIX/data"
PGRUN="$PG_PREFIX/run"
DB_NAME="sitecomply"

export LD_LIBRARY_PATH="$PG_PREFIX/usr/lib/x86_64-linux-gnu:$PG_PREFIX/usr/lib/postgresql/16/lib:${LD_LIBRARY_PATH:-}"

case "${1:-}" in
  init)
    mkdir -p "$PGRUN"
    "$PGBIN/initdb" -D "$PGDATA" --locale=C.UTF-8 --encoding=UTF8 -U postgres
    "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PG_PREFIX/server.log" \
      -o "-p $PG_PORT -k $PGRUN -c listen_addresses=localhost" start
    sleep 2
    "$PGBIN/createdb" -h localhost -p "$PG_PORT" -U postgres "$DB_NAME"
    echo "Initialised. DATABASE_URL=postgresql://postgres:postgres@localhost:$PG_PORT/$DB_NAME?schema=public"
    ;;
  start)
    "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PG_PREFIX/server.log" \
      -o "-p $PG_PORT -k $PGRUN -c listen_addresses=localhost" start
    ;;
  stop)
    "$PGBIN/pg_ctl" -D "$PGDATA" stop
    ;;
  status)
    "$PGBIN/pg_ctl" -D "$PGDATA" status
    ;;
  psql)
    "$PGBIN/psql" -h localhost -p "$PG_PORT" -U postgres "$DB_NAME"
    ;;
  *)
    echo "Usage: $0 {init|start|stop|status|psql}" >&2
    exit 1
    ;;
esac
