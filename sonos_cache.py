"""Sonos-only device cache for the mobile controller."""

from __future__ import annotations

import copy
import threading
import time
from typing import Any

from sonos_helpers import normalize_device_row

_lock = threading.Lock()
_snapshot: dict[str, Any] = {
    "updated_at": 0.0,
    "unified_devices": None,
    "sonos_catalog": [],
}


def ensure_snapshot() -> None:
    with _lock:
        if _snapshot.get("unified_devices") is None:
            _snapshot["unified_devices"] = {
                "updated_at": 0,
                "count": 0,
                "rows": [],
                "sonos_errors": [],
            }


def refresh_sonos_cache() -> None:
    from sonos_client import SonosError, list_speakers, list_speakers_from_catalog
    from sonos_devices import build_sonos_devices

    sonos_errors: list[str] = []
    try:
        sonos_catalog = list_speakers()
    except (SonosError, OSError) as exc:
        sonos_catalog = []
        sonos_errors.append(str(exc))

    if not sonos_catalog:
        with _lock:
            previous = list(_snapshot.get("sonos_catalog") or [])
        if previous:
            try:
                sonos_catalog = list_speakers_from_catalog(previous)
            except (SonosError, OSError) as exc:
                sonos_errors.append(str(exc))
            if not sonos_catalog:
                sonos_errors.append("Sonos vorübergehend nicht erreichbar (SSDP/IP-Fallback leer)")

    sonos_devices, device_errors = build_sonos_devices(sonos_catalog)
    sonos_errors.extend(device_errors)

    now = time.time()
    with _lock:
        if sonos_catalog:
            _snapshot["sonos_catalog"] = sonos_catalog
        unified = _snapshot.get("unified_devices")
        if not unified:
            return
        unified["rows"] = sonos_devices
        unified["count"] = len(sonos_devices)
        unified["updated_at"] = now
        unified["sonos_errors"] = sonos_errors


def get_unified_devices() -> dict[str, Any]:
    with _lock:
        data = _snapshot.get("unified_devices")
        if data is None:
            return {
                "updated_at": 0,
                "count": 0,
                "rows": [],
                "sonos_errors": [],
            }
        result = copy.deepcopy(data)
    result["rows"] = [normalize_device_row(row) for row in result.get("rows", [])]
    return result
