#!/usr/bin/env bash
# Shared helpers for Better Sonos Controller installers.
set -euo pipefail

bsc_die() {
  echo "✗ $*" >&2
  exit 1
}

bsc_info() {
  echo "→ $*"
}

bsc_ok() {
  echo "✓ $*"
}

bsc_need_cmd() {
  local cmd="$1"
  local hint="${2:-Install $cmd and try again.}"
  if command -v "$cmd" >/dev/null 2>&1; then
    return 0
  fi
  bsc_die "$cmd not found. $hint"
}

bsc_check_os() {
  case "$(uname -s)" in
    Darwin|Linux) ;;
    *)
      echo "⚠ Unsupported OS: $(uname -s). macOS and Linux are tested." >&2
      ;;
  esac
}

bsc_check_python() {
  bsc_need_cmd python3 "On Mac run: xcode-select --install
  Or install Python from https://www.python.org/downloads/
  On Ubuntu/Debian: sudo apt install python3 python3-venv python3-pip"

  local ver raw major minor
  raw="$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"
  major="$(python3 -c 'import sys; print(sys.version_info.major)')"
  minor="$(python3 -c 'import sys; print(sys.version_info.minor)')"
  ver="${major}.${minor}"

  if (( major < 3 || (major == 3 && minor < 10) )); then
    bsc_die "Python 3.10+ required (found ${raw}).
  On Mac with Homebrew: brew install python@3.12
  On Ubuntu/Debian: sudo apt install python3"
  fi
  bsc_ok "Python ${raw}"
}

bsc_check_venv_module() {
  if python3 -c 'import venv' 2>/dev/null; then
    bsc_ok "Python venv module"
    return 0
  fi
  bsc_die "Python venv module missing.
  On Ubuntu/Debian: sudo apt install python3-venv"
}

bsc_check_tools() {
  bsc_need_cmd curl "curl is used for health checks."
  if command -v lsof >/dev/null 2>&1; then
    bsc_ok "lsof"
  else
    echo "⚠ lsof not found — cannot auto-stop old server on the same port." >&2
  fi
}

bsc_chmod_scripts() {
  chmod +x "$ROOT/install.sh" 2>/dev/null || true
  for f in "$ROOT"/local-scripts/*.sh; do
    [[ -f "$f" ]] && chmod +x "$f"
  done
}

bsc_ensure_config() {
  local config="$ROOT/config/sonos-mobile.env"
  if [[ -f "$config" ]]; then
    bsc_ok "Config found"
    return 0
  fi
  bsc_info "Creating default config …"
  mkdir -p "$ROOT/config"
  cat >"$config" <<'EOF'
SONOS_ENABLED=1
SONOS_MOBILE_BIND=0.0.0.0
SONOS_MOBILE_PORT=8766
SONOS_DISCOVERY_TIMEOUT=5
SONOS_IP=
EOF
  bsc_ok "Created $config"
}

bsc_read_port() {
  local config="$ROOT/config/sonos-mobile.env"
  PORT="${SONOS_MOBILE_PORT:-8766}"
  [[ -f "$config" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" != *=* ]] && continue
    local key="${line%%=*}"
    local value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    value="${value#\"}"; value="${value%\"}"
    value="${value#\'}"; value="${value%\'}"
    if [[ "$key" == "SONOS_MOBILE_PORT" && -n "$value" ]]; then
      PORT="$value"
    fi
  done <"$config"
}

bsc_ensure_venv() {
  local py="$ROOT/.venv/bin/python3"
  local pip="$ROOT/.venv/bin/pip"
  if [[ ! -x "$py" ]]; then
    bsc_info "Creating virtual environment …"
    python3 -m venv "$ROOT/.venv"
  fi
  bsc_info "Installing Python packages …"
  "$py" -m pip install -q --upgrade pip
  "$pip" install -q -r "$ROOT/requirements.txt"
  bsc_ok "Dependencies installed"
}

bsc_stop_port() {
  bsc_read_port
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti:"${PORT}" 2>/dev/null | xargs kill 2>/dev/null || true
    sleep 1
  fi
}

bsc_get_lan_ip() {
  LAN_IP=""
  if command -v ipconfig >/dev/null 2>&1; then
    LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  elif command -v hostname >/dev/null 2>&1; then
    LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
}

bsc_smoke_test() {
  bsc_read_port
  bsc_info "Testing server on port ${PORT} …"
  "$ROOT/local-scripts/start.sh" &
  local pid=$!
  trap 'kill "$pid" 2>/dev/null || true' RETURN

  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 15; do
    if curl -sf --connect-timeout 2 "http://127.0.0.1:${PORT}/api/sonos/status" >/dev/null; then
      break
    fi
    sleep 1
  done

  if ! curl -sf --connect-timeout 3 "http://127.0.0.1:${PORT}/api/sonos/status" >/dev/null; then
    bsc_die "Server did not respond on port ${PORT}."
  fi

  local status count
  status="$(curl -sf "http://127.0.0.1:${PORT}/api/sonos/status")"
  count="$("$ROOT/.venv/bin/python3" -c "import json,sys; print(json.load(sys.stdin).get('speaker_count',0))" <<<"$status")"
  bsc_get_lan_ip

  echo ""
  bsc_ok "Setup complete — ${count} Sonos speaker(s) found"
  echo ""
  echo "  Open on this computer:  http://127.0.0.1:${PORT}/"
  echo "  Help / icons guide:     http://127.0.0.1:${PORT}/help"
  if [[ -n "$LAN_IP" ]]; then
    echo "  Open on your phone:      http://${LAN_IP}:${PORT}/"
  fi
  echo ""
  if [[ "$count" == "0" ]]; then
    echo "  ⚠ No speakers found. Same Wi‑Fi? Try setting SONOS_IP in config/sonos-mobile.env"
    echo ""
  fi
}

bsc_print_next_steps() {
  bsc_read_port
  echo "  Start now:     $ROOT/install.sh --start"
  echo "  Auto-start Mac: $ROOT/install.sh --autostart"
  echo "  Config:        $ROOT/config/sonos-mobile.env"
}
