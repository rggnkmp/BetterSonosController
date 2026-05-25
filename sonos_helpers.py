"""Formatting helpers for Sonos devices in the unified UI."""

from __future__ import annotations

from typing import Any


def format_status(snapshot: dict[str, Any]) -> str:
    parts: list[str] = []
    track = snapshot.get("track") or {}
    title = track.get("title") or ""
    artist = track.get("artist") or ""

    if snapshot.get("is_playing"):
        if title and artist:
            parts.append(f"▶ {artist} – {title}")
        elif title:
            parts.append(f"▶ {title}")
        else:
            parts.append("▶ Wiedergabe")
    elif snapshot.get("transport_state") == "PAUSED_PLAYBACK":
        parts.append("⏸ Pausiert")
    else:
        parts.append("Bereit")

    volume = snapshot.get("volume")
    if volume is not None:
        parts.append(f"Lautstärke {volume}%")
    if snapshot.get("muted"):
        parts.append("Stumm")
    return " · ".join(parts)


def control_kind(_snapshot: dict[str, Any]) -> str:
    return "media"


def normalize_device_row(row: dict[str, Any]) -> dict[str, Any]:
    if row.get("source") != "sonos":
        return row
    raw = row.get("raw_status") or {}
    if not row.get("group") and raw.get("group"):
        row["group"] = raw["group"]
    if row.get("is_playing") is None:
        row["is_playing"] = bool(raw.get("is_playing") or row.get("is_on"))
    if row.get("is_on") is None:
        row["is_on"] = bool(row.get("is_playing"))
    return row
