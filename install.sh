#!/usr/bin/env bash
# Better Sonos Controller — one-shot installer
#
#   ./install.sh                 # check deps, install, test
#   ./install.sh --start         # install + run server (keep Terminal open)
#   ./install.sh --autostart     # install + Mac login autostart
#
# One line (download + install):
#   curl -fsSL https://raw.githubusercontent.com/rggnkmp/BetterSonosController/main/install.sh | bash
#
# One line (download + install + start):
#   curl -fsSL https://raw.githubusercontent.com/rggnkmp/BetterSonosController/main/install.sh | bash -s -- --start
set -euo pipefail

REPO_URL="https://github.com/rggnkmp/BetterSonosController.git"
INSTALL_DIR="${BSC_INSTALL_DIR:-$HOME/BetterSonosController}"
AUTOSTART=0
START=0

for arg in "$@"; do
  case "$arg" in
    --autostart) AUTOSTART=1 ;;
    --start) START=1 ;;
    -h|--help)
      echo "Usage: install.sh [--start] [--autostart]"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

resolve_root() {
  if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -f "$ROOT/app.py" ]]; then
      return 0
    fi
  fi
  ROOT=""
}

resolve_root
if [[ -z "$ROOT" ]]; then
  if ! command -v git >/dev/null 2>&1; then
    echo "✗ git not found. Install git, then run:" >&2
    echo "  git clone $REPO_URL" >&2
    echo "  cd BetterSonosController && ./install.sh" >&2
    exit 1
  fi
  echo "→ Downloading to $INSTALL_DIR …"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    git -C "$INSTALL_DIR" pull --ff-only
  elif [[ -d "$INSTALL_DIR" ]]; then
    bsc_die "$INSTALL_DIR exists but is not a git repo. Remove it or set BSC_INSTALL_DIR."
  else
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
  ROOT="$INSTALL_DIR"
fi

cd "$ROOT"
# shellcheck source=local-scripts/lib.sh
source "$ROOT/local-scripts/lib.sh"

echo "Better Sonos Controller — installer"
echo "  Folder: $ROOT"
echo ""

bsc_check_os
bsc_check_python
bsc_check_venv_module
bsc_check_tools
bsc_chmod_scripts
bsc_ensure_config

if [[ "$AUTOSTART" -eq 1 ]]; then
  bsc_ensure_venv
  "$ROOT/local-scripts/install-launchagent.sh"
  exit 0
fi

bsc_stop_port
bsc_ensure_venv

if [[ "$START" -eq 1 ]]; then
  bsc_read_port
  echo ""
  bsc_ok "Starting server on port ${PORT} …"
  bsc_get_lan_ip
  echo "  http://127.0.0.1:${PORT}/"
  [[ -n "$LAN_IP" ]] && echo "  http://${LAN_IP}:${PORT}/"
  echo ""
  exec "$ROOT/local-scripts/start.sh"
fi

bsc_smoke_test
bsc_print_next_steps
