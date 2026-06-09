#!/usr/bin/env bash
#
# DB-backed INTEGRATION tests: spin up a throwaway postgres:18 (matching prod's
# krova-db), apply the full migration chain, then run the integration suite
# against the REAL database with the REAL schema. Tears the container down
# after. Tests exercise server-side DB logic (auth/signup validation, plan
# limits, billing cascade, idempotency, …) against actual rows — the layer the
# pure unit suite (`pnpm test`) can't cover.
#
# Requires Docker + a `.env.test` (copy from .env.test.example). Fully isolated:
# the throwaway DB is destroyed on exit; the non-DB env values are dummies.
#
# Run: pnpm test:integration
set -uo pipefail

ENV_FILE=".env.test"
CONTAINER="krova-itest-$$"
PORT="55434" # MUST match DATABASE_URL in .env.test
DB_URL="postgres://krovatest:krovatest@localhost:${PORT}/krovatest"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if [ ! -f "$ENV_FILE" ]; then
  echo "FATAL: $ENV_FILE missing — copy .env.test.example to .env.test and fill it in." >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "FATAL: Docker is not running." >&2
  exit 2
fi

echo "==> Starting throwaway postgres:18 ($CONTAINER, port $PORT)"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER=krovatest -e POSTGRES_PASSWORD=krovatest -e POSTGRES_DB=krovatest \
  -p "${PORT}:5432" postgres:18 >/dev/null || {
  echo "FATAL: could not start postgres (is port $PORT free?)" >&2
  exit 1
}
for i in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U krovatest -d krovatest >/dev/null 2>&1 && break
  sleep 1
done

echo "==> Applying migration chain"
if ! DATABASE_URL="$DB_URL" pnpm db:migrate >/dev/null 2>&1; then
  echo "FAIL: migrations did not apply to the test DB" >&2
  exit 1
fi

echo "==> Running integration suite"
# node --env-file loads .env.test (correct dotenv parsing for quoted/spaced
# values); --import tsx registers the TS loader. DATABASE_URL in .env.test
# already points at the throwaway PG above.
# --test-concurrency=1 runs the files SERIALLY: they share one throwaway DB, so
# parallel files would (a) multiply lib/db's 20-conn pool past postgres's
# max_connections and (b) race on shared singletons (the platform_settings row
# the top-up test mutates). Serial keeps each file's DB state deterministic.
node --env-file="$ENV_FILE" --import tsx --test --test-concurrency=1 "tests/integration/**/*.test.ts"
RESULT=$?

if [ "$RESULT" = 0 ]; then
  echo; echo "================ integration suite PASSED ================"
else
  echo; echo "================ integration suite FAILED (exit $RESULT) ================" >&2
fi
exit "$RESULT"
