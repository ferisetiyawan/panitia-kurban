#!/usr/bin/env bash
# Deploy panitia-kurban app to cPanel via SSH + tar pipe (atomic swap).
#
# Usage:
#   CPANEL_HOST=<host> CPANEL_USER=<user> [REMOTE_PATH=<path>] \
#     ./scripts/cpanel-deploy.sh [--dist] [--client] [--restart] [--dry-run]
#
# Flags (combinable):
#   --dist        Upload dist/ (compiled NestJS backend)
#   --client      Upload client/ (static HTML)
#   --restart     Trigger Passenger restart (touch tmp/restart.txt)
#   --dry-run     Print actions without executing
#   --help, -h    Show this help
#
# No flag → full deploy: --dist --client --restart
#
# Required env:
#   CPANEL_HOST   SSH host (cPanel server)
#   CPANEL_USER   cPanel username
#
# Optional env:
#   REMOTE_PATH   Default: public_html/kurban.masjidalhijrahcge.id
#
# Atomic swap pattern: each upload goes to <target>.tmp, then mv into place
# after extract succeeds — so a failed tar mid-upload doesn't leave the
# server in a broken state. Old <target> moves to <target>.old, then deleted.

set -euo pipefail

DO_DIST=0
DO_CLIENT=0
DO_RESTART=0
DRY_RUN=0

print_help() {
  sed -n '/^# Usage:/,/^# Atomic swap/p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dist)    DO_DIST=1; shift ;;
    --client)  DO_CLIENT=1; shift ;;
    --restart) DO_RESTART=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) print_help; exit 0 ;;
    *) echo "Unknown flag: $1 (use --help)" >&2; exit 1 ;;
  esac
done

# No action flag → default to full deploy
if [[ $DO_DIST -eq 0 && $DO_CLIENT -eq 0 && $DO_RESTART -eq 0 ]]; then
  DO_DIST=1; DO_CLIENT=1; DO_RESTART=1
fi

# Auto-source .env if present (looks in repo root) — keeps cPanel creds out
# of shell rc / git, lives next to existing DB/JWT vars.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

: "${CPANEL_HOST:?Set CPANEL_HOST=<host> in .env or shell (cPanel SSH host)}"
: "${CPANEL_USER:?Set CPANEL_USER=<user> in .env or shell (cPanel username)}"
REMOTE_PATH="${REMOTE_PATH:-public_html/kurban.masjidalhijrahcge.id}"

SSH_ARGS=(-o LogLevel=ERROR "${CPANEL_USER}@${CPANEL_HOST}")

run_ssh() {
  local cmd="$1"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  [dry-run] ssh: $cmd"
  else
    ssh "${SSH_ARGS[@]}" "$cmd" 2>/dev/null
  fi
}

upload_dir() {
  local src="$1" target="$2"
  echo "=== Upload ${src}/ → ${REMOTE_PATH}/${target}/ (atomic swap) ==="

  if [[ ! -d "$src" ]]; then
    echo "  ✗ '$src' not found locally. Build first?" >&2
    exit 1
  fi

  run_ssh "rm -rf ${REMOTE_PATH}/${target}.tmp && mkdir -p ${REMOTE_PATH}/${target}.tmp"

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  [dry-run] tar -czf - -C $src . | ssh ... 'tar -xzf - -C ${REMOTE_PATH}/${target}.tmp'"
  else
    tar -czf - -C "$src" . | ssh "${SSH_ARGS[@]}" "tar -xzf - -C ${REMOTE_PATH}/${target}.tmp" 2>/dev/null
  fi

  run_ssh "cd ${REMOTE_PATH} && rm -rf ${target}.old && mv ${target} ${target}.old && mv ${target}.tmp ${target} && rm -rf ${target}.old"
  echo "  ✓ ${target} deployed"
}

[[ $DO_DIST -eq 1 ]]   && upload_dir dist dist
[[ $DO_CLIENT -eq 1 ]] && upload_dir client client

if [[ $DO_RESTART -eq 1 ]]; then
  echo "=== Restart Passenger ==="
  run_ssh "touch ${REMOTE_PATH}/tmp/restart.txt"
  echo "  ✓ restart triggered"
fi

echo ""
if [[ $DRY_RUN -eq 1 ]]; then
  echo "(dry-run — no changes applied)"
else
  echo "Done. Smoke test: ./scripts/cpanel-verify.sh"
fi
