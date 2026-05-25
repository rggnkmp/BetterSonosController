#!/usr/bin/env bash
# LaunchAgent: Sonos Mobile startet nach Login/Reboot automatisch.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY="${SONOS_MOBILE_DIR:-$HOME/sonos-mobile}"
RUNNER="$DEPLOY/local-scripts/start.sh"
PLIST="$HOME/Library/LaunchAgents/dev.sonos.mobile.plist"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"
LABEL="dev.sonos.mobile"
PORT="${SONOS_MOBILE_PORT:-8766}"

if [[ ! -f "$PROJECT/config/sonos-mobile.env" ]]; then
  echo "✗ Fehlt: $PROJECT/config/sonos-mobile.env" >&2
  exit 1
fi

echo "→ Sync nach $DEPLOY …"
mkdir -p "$DEPLOY"
rsync -a --delete \
  --exclude '.git/' \
  --exclude '.venv/' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  "$PROJECT/" "$DEPLOY/"

chmod +x "$RUNNER" "$DEPLOY/local-scripts/setup.sh"

echo "→ Python venv in $DEPLOY …"
if [[ ! -x "$DEPLOY/.venv/bin/python3" ]]; then
  python3 -m venv "$DEPLOY/.venv"
fi
"$DEPLOY/.venv/bin/pip" install -q -r "$DEPLOY/requirements.txt"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$HOME/Library/Logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${RUNNER}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${DEPLOY}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${HOME}/Library/Logs/sonos-mobile.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/Library/Logs/sonos-mobile.err.log</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
EOF

echo "→ Stoppe Prozess auf Port ${PORT} (falls läuft) …"
lsof -ti:"${PORT}" 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1

launchctl bootout "$DOMAIN" "$PLIST" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl kickstart -k "$DOMAIN/$LABEL"

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf --connect-timeout 3 "http://127.0.0.1:${PORT}/api/sonos/status" >/dev/null; then
    echo "✓ Sonos Mobile läuft: http://127.0.0.1:${PORT}/"
    echo "  Deploy: $DEPLOY"
    echo "  Config: $DEPLOY/config/sonos-mobile.env"
    echo "  Logs:   ~/Library/Logs/sonos-mobile.log"
    exit 0
  fi
  sleep 2
done

echo "✗ Sonos Mobile antwortet nicht — Log prüfen:"
echo "  tail -30 ~/Library/Logs/sonos-mobile.err.log"
exit 1
