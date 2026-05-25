#!/usr/bin/env bash
# Komplettes Setup für Sonos Mobile.
# Config: config/sonos-mobile.env (SONOS_IP nur bei Bedarf anpassen)
#
#   ./local-scripts/setup.sh              # venv + Test
#   ./local-scripts/setup.sh --autostart  # + LaunchAgent (~/sonos-mobile)
#   ./local-scripts/setup.sh --start      # Server starten
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG="$ROOT/config/sonos-mobile.env"
PORT="${SONOS_MOBILE_PORT:-8766}"
AUTOSTART=0
START=0

for arg in "$@"; do
  case "$arg" in
    --autostart) AUTOSTART=1 ;;
    --start) START=1 ;;
    -h|--help)
      echo "Usage: $0 [--autostart] [--start]"
      exit 0
      ;;
    *)
      echo "Unbekannte Option: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$CONFIG" ]]; then
  echo "✗ Fehlt: $CONFIG" >&2
  exit 1
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  line="${line#"${line%%[![:space:]]*}"}"
  [[ -z "$line" || "$line" != *=* ]] && continue
  key="${line%%=*}"
  value="${line#*=}"
  key="${key%"${key##*[![:space:]]}"}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  value="${value#\"}"; value="${value%\"}"
  value="${value#\'}"; value="${value%\'}"
  if [[ "$key" == "SONOS_MOBILE_PORT" && -n "$value" ]]; then
    PORT="$value"
  fi
done < "$CONFIG"

echo "→ Sonos Mobile Setup"
echo "  Config: $CONFIG"
echo "  Port:   $PORT"
echo ""

if [[ "$AUTOSTART" -eq 1 ]]; then
  "$SCRIPT_DIR/install-launchagent.sh"
  exit 0
fi

echo "→ Python venv …"
if [[ ! -x "$ROOT/.venv/bin/python3" ]]; then
  python3 -m venv "$ROOT/.venv"
fi
"$ROOT/.venv/bin/pip" install -q -r "$ROOT/requirements.txt"

echo "→ Stoppe alten Prozess auf Port ${PORT} (falls läuft) …"
lsof -ti:"${PORT}" 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1

if [[ "$START" -eq 1 ]]; then
  exec "$SCRIPT_DIR/start.sh"
fi

echo "→ Kurztest (Server temporär) …"
"$SCRIPT_DIR/start.sh" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf --connect-timeout 2 "http://127.0.0.1:${PORT}/api/sonos/status" >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl -sf --connect-timeout 3 "http://127.0.0.1:${PORT}/api/sonos/status" >/dev/null; then
  echo "✗ Server antwortet nicht auf Port ${PORT}" >&2
  exit 1
fi

STATUS="$(curl -sf "http://127.0.0.1:${PORT}/api/sonos/status")"
COUNT="$(python3 -c "import json,sys; print(json.load(sys.stdin).get('speaker_count',0))" <<<"$STATUS")"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"

echo ""
echo "✓ Setup OK — ${COUNT} Sonos-Lautsprecher erkannt"
echo ""
echo "  Lokal:  http://127.0.0.1:${PORT}/"
if [[ -n "$LAN_IP" ]]; then
  echo "  Handy:  http://${LAN_IP}:${PORT}/"
fi
echo ""
echo "  Dauerbetrieb:  $0 --autostart"
echo "  Manuell start: $0 --start"
echo "  Config:        $CONFIG"
