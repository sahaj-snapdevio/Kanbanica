#!/usr/bin/env bash
# Block pushes that change db/schema/** without a matching db/migrations/** change.
# Range: commits being pushed (@{push}..HEAD); falls back to origin/main..HEAD on first push.
set -e

if git rev-parse --verify --quiet '@{push}..HEAD' >/dev/null 2>&1; then
  diff_range='@{push}..HEAD'
elif git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
  diff_range='origin/main..HEAD'
else
  exit 0
fi

changed=$(git diff --name-only "$diff_range")
# Exclude type-only / re-export files that never contain DDL (no pgTable/pgEnum).
schema_changed=$(echo "$changed" | grep -E '^db/schema/' | grep -Ev '^db/schema/(types|index)\.ts$' || true)
migrations_changed=$(echo "$changed" | grep -E '^db/migrations/' || true)

if [ -n "$schema_changed" ] && [ -z "$migrations_changed" ]; then
  echo ""
  echo "✗ Schema changed but no migration is included in this push:"
  echo "$schema_changed" | sed 's/^/    /'
  echo ""
  echo "  Run \`pnpm db:generate\`, review the new SQL under db/migrations/,"
  echo "  commit it, and push again."
  echo ""
  exit 1
fi
