# Better Sonos Controller

A simple, touch-friendly web app to control Sonos speakers on your local network — from your phone, tablet, or computer. No Sonos account required. No cloud. Just a small server on your home network.

**Live help page (when running):** open `/help` in the browser, e.g. `http://127.0.0.1:8766/help`

---

## What you need

- A **Mac or Linux computer** that stays on your home Wi‑Fi (this runs the server)
- **Python 3.10+** (macOS usually has it; check with `python3 --version`)
- **Sonos speakers** on the **same Wi‑Fi** as the computer
- A phone/tablet/computer on the same network to open the web page

No Home Assistant, no Homee, no extra accounts.

---

## Installation (easy mode)

**One command** — downloads (if needed), checks dependencies, installs everything, tests Sonos:

```bash
curl -fsSL https://raw.githubusercontent.com/rggnkmp/BetterSonosController/main/install.sh | bash
```

**Download, install, and start the server** (leave Terminal open):

```bash
curl -fsSL https://raw.githubusercontent.com/rggnkmp/BetterSonosController/main/install.sh | bash -s -- --start
```

Already cloned the repo? From the project folder:

```bash
./install.sh              # check + install + test
./install.sh --start      # install + run server
./install.sh --autostart  # install + start after every login (Mac)
```

The installer automatically:

- checks Python 3.10+, `venv`, and `curl`
- makes scripts executable
- creates `config/sonos-mobile.env` if missing
- installs Python packages into `.venv/`
- runs a quick test and prints your URLs

---

## Installation (manual)

### 1. Download the project

Open **Terminal** and run:

```bash
git clone https://github.com/rggnkmp/BetterSonosController.git
cd BetterSonosController
```

Don't have git? Download the ZIP from GitHub (**Code → Download ZIP**), unzip it, then `cd` into the folder in Terminal.

### 2. Run the setup script

```bash
./install.sh
```

This replaces the older `./local-scripts/setup.sh` (which still works as a shortcut).

This will:

- create a Python virtual environment (`.venv/`)
- install dependencies
- start the server briefly and test your Sonos speakers

If you see **“Setup OK — N speakers found”**, you're good.

### 3. Start the server

```bash
./install.sh --start
```

Leave this Terminal window open while you use the controller.

### 4. Open the app

On the **same computer**:

```
http://127.0.0.1:8766/
```

On your **phone** (same Wi‑Fi):

1. Find your computer's IP (on Mac: **System Settings → Network**, or run `ipconfig getifaddr en0` in Terminal)
2. Open in Safari/Chrome: `http://YOUR-COMPUTER-IP:8766/`
3. Optional: **Share → Add to Home Screen** for an app-like icon

### 5. Read the help page

Open **`/help`** for a full explanation of every button and icon:

```
http://127.0.0.1:8766/help
```

---

## Start automatically after login (Mac)

So you don't have to run Terminal every time:

```bash
./install.sh --autostart
```

This copies the app to `~/sonos-mobile/` and registers a LaunchAgent. After a reboot, the server should start on its own.

Logs: `~/Library/Logs/sonos-mobile.log`

---

## Configuration (optional)

Edit **`config/sonos-mobile.env`** — nothing else to create.

| Setting | Default | Meaning |
|---------|---------|---------|
| `SONOS_MOBILE_PORT` | `8766` | Web port |
| `SONOS_MOBILE_BIND` | `0.0.0.0` | `0.0.0.0` = phone can connect; `127.0.0.1` = this Mac only |
| `SONOS_IP` | *(empty)* | Comma-separated speaker IPs if auto-discovery fails |
| `SONOS_DISCOVERY_TIMEOUT` | `5` | Seconds to wait for network discovery |

Example with fixed IPs:

```env
SONOS_IP=192.168.1.50,192.168.1.51
```

Restart the server after changes.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| **Connection failed** in the browser | Server not running → `./install.sh --start` |
| **No speakers found** | Same Wi‑Fi? Set `SONOS_IP` in config |
| **Phone can't connect** | Use computer IP, not `127.0.0.1`. Check firewall allows port 8766 |
| **Port already in use** | Change `SONOS_MOBILE_PORT` in config |

Stop the server:

```bash
lsof -ti:8766 | xargs kill
```

---

## Features

- Now playing with album art, seek, play/pause, skip
- Per-speaker volume and mute
- Group speakers via drag & drop
- Leave group, change coordinator, dismiss group
- Auto-refresh every few seconds
- Mobile-first dark UI

---

## License

[MIT License](LICENSE) — free to use, modify, and share.

**Attribution:** not legally required beyond keeping the copyright notice, but a link back to [this repository](https://github.com/rggnkmp/BetterSonosController) is appreciated if you publish a fork or derivative.

---

## Credits

Built with [Flask](https://flask.palletsprojects.com/) and [SoCo](https://github.com/SoCo/SoCo).

Not affiliated with Sonos, Inc.
