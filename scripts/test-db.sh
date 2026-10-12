#!/usr/bin/env bash
# Applies the migrations to a throwaway database and runs the security tests.
# Needs a Postgres server; connection comes from the usual PG* variables
# (in CI a Postgres service container, locally any Postgres 15+).
set -euo pipefail
cd "$(dirname "$0")/.."

DB="app_famiglia_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT

run() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

run -f supabase/tests/auth_stub.sql
for f in supabase/migrations/*.sql; do
  # pg_cron, pg_net and Vault only exist on Supabase; the schedule is not part of these tests.
  if grep -q 'cron.schedule' "$f"; then
    echo "skip $f (Supabase-only extensions)"
    continue
  fi
  echo "apply $f"
  run -f "$f"
done
run -f supabase/tests/rls_test.sql >/dev/null
echo 'All database security checks passed.'
