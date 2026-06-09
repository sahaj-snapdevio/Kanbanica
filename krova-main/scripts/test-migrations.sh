#!/usr/bin/env bash
#
# Migration smoke test: apply the ENTIRE migration chain (0000 → latest) to a
# throwaway postgres:18 (matching production's krova-db) and assert it succeeds
# with the expected migration count.
#
# This guards the Rule-6 incident class: a hand-edited / wrong-epoch journal
# entry makes `drizzle-kit migrate` SILENTLY skip migrations (the 2026-05-04
# user_data production-down). Running the full chain on a clean DB proves every
# pending migration actually applies and the journal is consistent — catch it
# in CI / pre-deploy, never on the prod worker's startup `db:migrate`.
#
# Requires Docker. Fully isolated — uses a throwaway container + an explicit
# DATABASE_URL (NEVER reads .env), so production is never touched.
#
# Run: pnpm test:migrations

set -uo pipefail

CONTAINER="krova-migtest-$$"
PORT="${MIGTEST_PORT:-55433}"
URL="postgres://t:t@localhost:${PORT}/krovatest"
PG_IMAGE="${MIGTEST_PG_IMAGE:-postgres:18}"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if ! docker info >/dev/null 2>&1; then
  echo "FATAL: Docker is not running — start Docker and re-run." >&2
  exit 2
fi

echo "==> Starting throwaway $PG_IMAGE (container $CONTAINER, port $PORT)"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=t -e POSTGRES_USER=t -e POSTGRES_DB=krovatest \
  -p "${PORT}:5432" "$PG_IMAGE" >/dev/null || {
  echo "FATAL: could not start postgres container" >&2
  exit 1
}

for i in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U t -d krovatest >/dev/null 2>&1; then
    echo "    ready after ${i}s"
    break
  fi
  sleep 1
done

# Expected count = number of entries in the drizzle journal.
EXPECTED=$(node -e "console.log(require('./db/migrations/meta/_journal.json').entries.length)")
echo "==> Applying full migration chain ($EXPECTED migrations expected)"

if ! DATABASE_URL="$URL" pnpm db:migrate 2>&1 | sed 's/^/    /'; then
  echo "FAIL: drizzle-kit migrate errored" >&2
  exit 1
fi

APPLIED=$(docker exec "$CONTAINER" psql -U t -d krovatest -tA \
  -c "select count(*) from drizzle.__drizzle_migrations;" 2>/dev/null | tr -d ' ')

echo "==> Applied $APPLIED / expected $EXPECTED"
if [ "$APPLIED" != "$EXPECTED" ]; then
  echo "FAIL: applied count ($APPLIED) != journal entries ($EXPECTED) — a migration was SILENTLY SKIPPED (check the journal 'when' epochs, Rule 6)." >&2
  exit 1
fi

# Re-running must be a no-op (idempotent) — applies 0 more.
echo "==> Re-running migrate (must be a no-op)"
DATABASE_URL="$URL" pnpm db:migrate >/dev/null 2>&1
APPLIED2=$(docker exec "$CONTAINER" psql -U t -d krovatest -tA \
  -c "select count(*) from drizzle.__drizzle_migrations;" 2>/dev/null | tr -d ' ')
if [ "$APPLIED2" != "$EXPECTED" ]; then
  echo "FAIL: a second migrate changed the count ($APPLIED2 != $EXPECTED) — migrations are not idempotent." >&2
  exit 1
fi

echo
echo "================ PASS: full chain applied cleanly + idempotently ($EXPECTED migrations) ================"
