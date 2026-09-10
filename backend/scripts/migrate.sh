#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL must be set}"

# Production migrations are an explicit release step. The application must run
# with AUTO_MIGRATE=false and never perform this command during startup.
exec alembic upgrade head
