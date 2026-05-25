"""Sonos device rows and control actions."""

from __future__ import annotations

import time
from typing import Any

from sonos_client import SonosError, control_speaker, is_enabled, list_speakers
from sonos_helpers import control_kind, format_status, normalize_device_row


def build_sonos_devices(
    catalog: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    devices: list[dict[str, Any]] = []
    errors: list[str] = []

    if not is_enabled():
        return devices, errors

    if catalog is None:
        try:
            catalog = list_speakers()
        except (SonosError, OSError) as exc:
            return devices, [str(exc)]

    fetched_at = time.time()
    for item in catalog:
        uid = item.get("uid", "")
        is_playing = bool(item.get("is_playing"))
        devices.append(
            normalize_device_row(
                {
                    "source": "sonos",
                    "device_id": uid,
                    "name": item.get("name", ""),
                    "device_type": item.get("model") or "Sonos",
                    "control_kind": control_kind(item),
                    "status": format_status(item),
                    "is_on": is_playing,
                    "is_playing": is_playing,
                    "controllable": True,
                    "has_toggle": True,
                    "has_press": False,
                    "toggle": {"device_id": uid},
                    "controls": [],
                    "attributes": [],
                    "volume": item.get("volume"),
                    "muted": item.get("muted"),
                    "track": item.get("track"),
                    "transport_state": item.get("transport_state"),
                    "group": item.get("group"),
                    "raw_status": item,
                    "last_changed": fetched_at,
                }
            )
        )

    return devices, errors


def control_device(device_id: str, action: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = payload or {}

    if action == "toggle":
        result = control_speaker(device_id, "toggle", payload)
    elif action in {"turnOn", "turnOff"}:
        result = control_speaker(device_id, action, payload)
    elif action == "set":
        result = control_speaker(device_id, "set", payload)
    elif action == "stop":
        result = control_speaker(device_id, "stop", payload)
    elif action == "next":
        result = control_speaker(device_id, "next", payload)
    elif action == "previous":
        result = control_speaker(device_id, "previous", payload)
    elif action == "seek":
        result = control_speaker(device_id, "seek", payload)
    elif action == "join":
        result = control_speaker(device_id, "join", payload)
    elif action == "unjoin":
        result = control_speaker(device_id, "unjoin", payload)
    elif action == "takeover_group":
        result = control_speaker(device_id, "takeover_group", payload)
    elif action == "transfer":
        result = control_speaker(device_id, "transfer", payload)
    elif action == "promote_coordinator":
        result = control_speaker(device_id, "promote_coordinator", payload)
    else:
        raise ValueError(f"Unbekannte Aktion: {action}")

    from sonos_cache import refresh_sonos_cache

    refresh_sonos_cache()
    return result
