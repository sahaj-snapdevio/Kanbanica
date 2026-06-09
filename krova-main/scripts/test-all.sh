#!/usr/bin/env bash
#
# THE one command that runs every automated test the repo has, in order of
# cost: pure unit (no deps) → migration smoke (Docker) → DB-backed integration
# (Docker). Each stage prints its own banner; this wrapper aggregates the
# results and exits non-zero if ANY stage failed, so CI / a pre-release gate
# can rely on a single exit code.
#
# Host-in-the-loop suites are deliberately NOT run here because they need real
# hardware that CI doesn't have:
#   • pnpm test:host <ssh-target>   — Firecracker lifecycle on a /dev/kvm host
# Run that manually before a release or after touching the SSH/Firecracker layer.
#
# Run: pnpm test:all
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

declare -a NAMES=()
declare -a CODES=()

run_stage() {
  local name="$1"
  shift
  echo
  echo "######################################################################"
  echo "# STAGE: $name"
  echo "######################################################################"
  "$@"
  local code=$?
  NAMES+=("$name")
  CODES+=("$code")
  return 0
}

run_stage "unit            (pnpm test)"        pnpm run --silent test
run_stage "migrations      (pnpm test:migrations)" bash scripts/test-migrations.sh
run_stage "integration     (pnpm test:integration)" bash scripts/test-integration.sh

echo
echo "======================================================================"
echo "  test:all summary"
echo "======================================================================"
FAILED=0
for i in "${!NAMES[@]}"; do
  if [ "${CODES[$i]}" = "0" ]; then
    printf "  PASS  %s\n" "${NAMES[$i]}"
  else
    printf "  FAIL  %s  (exit %s)\n" "${NAMES[$i]}" "${CODES[$i]}"
    FAILED=1
  fi
done
echo "======================================================================"

if [ "$FAILED" = "0" ]; then
  echo "  ALL STAGES PASSED"
  exit 0
fi
echo "  ONE OR MORE STAGES FAILED" >&2
exit 1
