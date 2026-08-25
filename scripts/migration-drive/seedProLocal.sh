#!/bin/bash
# Seed a fresh migration-drive test pro against the LOCAL dev DB (:5434).
# The shell-exported DATABASE_URL (local) beats both --env-file values.
set -euo pipefail
cd "$(dirname "$0")/../.."  # repo root: scripts/migration-drive/ -> .

export DATABASE_URL="$(grep '^DATABASE_URL=' .env.development.local | cut -d= -f2- | tr -d '"')"
echo "using ${DATABASE_URL#*@}"
exec npx tsx --env-file=.env.development.local --env-file=.env.local scripts/migration-drive/seedPro.ts "$@"
