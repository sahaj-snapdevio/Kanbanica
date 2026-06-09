#!/usr/bin/env bash
#
# ON-HOST cube-lifecycle E2E: throwaway postgres:18 + the full migration chain,
# then drive the REAL setup-phase + cube-lifecycle handlers against a REAL KVM
# dev host (E2E_SSH_HOST in .env.e2e), boot a cube from the REAL Krova rootfs,
# run in-guest tests, and exercise snapshot/sleep/wake/resize/backup/restore/
# delete. See tests/e2e/cube-lifecycle-e2e.ts.
#
# Requires: Docker, a `.env.e2e` (copy from .env.e2e.example), and a DEDICATED
# dev/test KVM host (the bootstrap phase hardens its sshd + the reboot phase
# reboots it — NEVER production). Excluded from `pnpm test:all` (needs a host).
#
# Run: pnpm test:e2e
set -uo pipefail

ENV_FILE=".env.e2e"
CONTAINER="krova-e2e-$$"
PORT="55435" # MUST match DATABASE_URL in .env.e2e
DB_URL="postgres://krovae2e:krovae2e@localhost:${PORT}/krovae2e"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if [ ! -f "$ENV_FILE" ]; then
  echo "FATAL: $ENV_FILE missing — copy .env.e2e.example to .env.e2e and fill it in." >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "FATAL: Docker is not running." >&2
  exit 2
fi

echo "==> Starting throwaway postgres:18 ($CONTAINER, port $PORT)"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER=krovae2e -e POSTGRES_PASSWORD=krovae2e -e POSTGRES_DB=krovae2e \
  -p "${PORT}:5432" postgres:18 >/dev/null || {
  echo "FATAL: could not start postgres (is port $PORT free?)" >&2
  exit 1
}
for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U krovae2e -d krovae2e >/dev/null 2>&1 && break
  sleep 1
done

echo "==> Applying migration chain"
if ! DATABASE_URL="$DB_URL" pnpm db:migrate >/dev/null 2>&1; then
  echo "FAIL: migrations did not apply to the E2E DB" >&2
  exit 1
fi

echo "==> Running cube-lifecycle E2E (real host, real rootfs)"
node --env-file="$ENV_FILE" --import tsx tests/e2e/cube-lifecycle-e2e.ts
RESULT=$?

if [ "$RESULT" = 0 ]; then
  echo; echo "================ E2E PASSED ================"
else
  echo; echo "================ E2E FAILED (exit $RESULT) ================" >&2
fi
exit "$RESULT"
