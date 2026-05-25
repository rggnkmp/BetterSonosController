#!/usr/bin/env python3
"""Standalone Sonos mobile controller."""

from __future__ import annotations

import os
from pathlib import Path

from env_loader import load_local_env
from flask import Flask, Response, jsonify, request, send_from_directory

from panel_audio import get_panel_audio
from sonos_cache import ensure_snapshot, get_unified_devices, refresh_sonos_cache
from sonos_client import get_connection_status as get_sonos_status
from sonos_devices import control_device

BASE_DIR = Path(__file__).resolve().parent
load_local_env(BASE_DIR / "config" / "sonos-mobile.env")
load_local_env()

APP_PORT = int(os.environ.get("SONOS_MOBILE_PORT", "8766"))
APP_HOST = os.environ.get("SONOS_MOBILE_BIND", "0.0.0.0")
STATIC_DIR = BASE_DIR / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")


def _ensure_sonos_cache() -> None:
    ensure_snapshot()
    try:
        refresh_sonos_cache()
    except Exception:
        pass


def _mobile_html() -> Response:
    path = STATIC_DIR / "audio-mobile.html"
    html = path.read_text(encoding="utf-8")
    html = html.replace("<body>", '<body data-standalone="1">', 1)
    html = html.replace("Sonos — Homee", "Sonos")
    return Response(html, mimetype="text/html")


@app.get("/")
@app.get("/m/audio")
def audio_mobile() -> Response:
    return _mobile_html()


@app.get("/help")
def help_page() -> Response:
    return send_from_directory(STATIC_DIR, "help.html")


@app.get("/api/sonos/status")
def api_sonos_status() -> Response:
    return jsonify(get_sonos_status())


@app.get("/api/sonos/devices")
def api_sonos_devices() -> Response:
    _ensure_sonos_cache()
    data = get_unified_devices()
    rows = [row for row in data.get("rows", []) if row.get("source") == "sonos"]
    return jsonify(
        {
            "updated_at": data.get("updated_at"),
            "count": len(rows),
            "rows": rows,
            "sonos_errors": data.get("sonos_errors") or [],
        }
    )


@app.get("/api/panel/audio")
def api_panel_audio() -> Response:
    _ensure_sonos_cache()
    try:
        return jsonify(get_panel_audio())
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.get("/api/panel/audio/cover")
def api_panel_audio_cover() -> Response:
    device_id = request.args.get("device_id", "").strip()
    if not device_id:
        return Response(status=400)
    _ensure_sonos_cache()
    album_art = ""
    data = get_unified_devices()
    for row in data.get("rows", []):
        if row.get("source") != "sonos":
            continue
        if str(row.get("device_id") or "") != device_id:
            continue
        track = row.get("track") or {}
        album_art = str(track.get("album_art") or "").strip()
        break
    if not album_art:
        return Response(status=404)
    try:
        import requests

        resp = requests.get(album_art, headers={"User-Agent": "Sonos-Mobile/1.0"}, timeout=8)
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "image/jpeg")
        return Response(resp.content, mimetype=content_type)
    except Exception:
        return Response(status=502)


@app.post("/api/devices/all/<source>/<device_id>/<action>")
def api_device_action(source: str, device_id: str, action: str) -> Response:
    if source != "sonos":
        return jsonify({"error": "Nur Sonos wird unterstützt"}), 400
    payload = request.get_json(silent=True) or {}
    try:
        return jsonify(control_device(device_id, action, payload))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.get("/static/<path:filename>")
def static_files(filename: str) -> Response:
    return send_from_directory(STATIC_DIR, filename)


def main() -> None:
    _ensure_sonos_cache()
    print(f"Better Sonos Controller: http://{APP_HOST}:{APP_PORT}/")
    print(f"Help: http://<deine-ip>:{APP_PORT}/help")
    app.run(host=APP_HOST, port=APP_PORT, debug=False, threaded=True)


if __name__ == "__main__":
    main()
