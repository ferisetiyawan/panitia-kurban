#!/usr/bin/env bash
# Smoke-test deployed panitia-kurban endpoints.
#
# Usage:
#   ./scripts/cpanel-verify.sh                  # public pages + pricing API
#   SHOW_STDERR=1 ./scripts/cpanel-verify.sh    # also tail stderr.log (requires CPANEL_HOST/USER)
#
# Optional env:
#   PROD_URL      Override base URL (default: https://kurban.masjidalhijrahcge.id)
#   SHOW_STDERR   If set, also SSH and tail stderr.log on server
#   CPANEL_HOST   Required if SHOW_STDERR=1
#   CPANEL_USER   Required if SHOW_STDERR=1

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

BASE="${PROD_URL:-https://kurban.masjidalhijrahcge.id}"

check() {
  local path="$1"
  printf "  %-30s " "$path"
  curl -fsS -o /dev/null -w "HTTP %{http_code}  %{time_total}s\n" \
    "${BASE}${path}" || echo "  ✗ failed"
}

echo "=== Smoke test: ${BASE} ==="
check /api/public/pricing
check /daftar.html
check /donate.html
check /status.html

if [[ -n "${SHOW_STDERR:-}" ]]; then
  : "${CPANEL_HOST:?SHOW_STDERR=1 requires CPANEL_HOST}"
  : "${CPANEL_USER:?SHOW_STDERR=1 requires CPANEL_USER}"
  REMOTE_PATH="${REMOTE_PATH:-public_html/kurban.masjidalhijrahcge.id}"
  echo ""
  echo "=== Recent stderr.log (last 10 lines) ==="
  ssh -o LogLevel=ERROR "${CPANEL_USER}@${CPANEL_HOST}" \
    "tail -10 ${REMOTE_PATH}/stderr.log" 2>/dev/null \
    | grep -v -E "(perl|locale|fallback|LANGUAGE|LC_|LANG|supported)" || true
fi
