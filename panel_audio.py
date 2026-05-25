"""Compact Sonos payload for the mobile UI."""

from __future__ import annotations

import time
from typing import Any

PANEL_AUDIO_OTHERS = 5
PANEL_GROUP_MEMBERS = 4


def _speaker_status(row: dict[str, Any]) -> str:
    track = row.get("track") or {}
    title = str(track.get("title") or "").strip()
    artist = str(track.get("artist") or "").strip()
    playing = bool(row.get("is_playing"))
    transport = str(row.get("transport_state") or "")

    if playing:
        if title and artist:
            return f"{artist} – {title}"
        if title:
            return title
        return "Wiedergabe"
    if transport == "PAUSED_PLAYBACK":
        return "Pausiert"
    return "Bereit"


def _is_active(row: dict[str, Any]) -> bool:
    if bool(row.get("is_playing")):
        return True
    return str(row.get("transport_state") or "") == "PAUSED_PLAYBACK"


def _speaker_entry(row: dict[str, Any]) -> dict[str, Any]:
    track = row.get("track") or {}
    group = row.get("group") or {}
    device_id = str(row.get("device_id") or "")
    coordinator_id = str(group.get("coordinator_uid") or device_id)
    member_uids = [str(uid) for uid in (group.get("member_uids") or []) if uid]
    group_size = len(member_uids) if member_uids else 1
    title = str(track.get("title") or "").strip()
    artist = str(track.get("artist") or "").strip()
    transport = str(row.get("transport_state") or "")

    return {
        "id": device_id,
        "name": str(row.get("name") or row.get("device_name") or "Sonos"),
        "status": _speaker_status(row),
        "playing": bool(row.get("is_playing")),
        "paused": transport == "PAUSED_PLAYBACK",
        "active": _is_active(row),
        "title": title,
        "artist": artist,
        "position_s": track.get("position_s"),
        "duration_s": track.get("duration_s"),
        "volume": row.get("volume"),
        "muted": bool(row.get("muted")),
        "cover_url": str(track.get("album_art") or "").strip(),
        "has_cover": bool(track.get("album_art")),
        "coordinator_id": coordinator_id,
        "is_coordinator": bool(group.get("is_coordinator")),
        "group_size": group_size,
        "member_uids": member_uids,
    }


def _track_title(entry: dict[str, Any]) -> str:
    title = str(entry.get("title") or "").strip()
    artist = str(entry.get("artist") or "").strip()
    if title:
        if artist:
            return f"{artist} – {title}"
        return title
    if entry.get("paused"):
        return "Pausiert"
    if entry.get("playing"):
        return "Wiedergabe"
    return str(entry.get("status") or "Bereit")


def _track_richness(entry: dict[str, Any]) -> tuple[int, str]:
    """Higher = more useful metadata for the now-playing card."""
    title = str(entry.get("title") or "").strip()
    artist = str(entry.get("artist") or "").strip()
    score = 0
    if title:
        score += 4
    if artist:
        score += 2
    if entry.get("has_cover"):
        score += 2
    if entry.get("duration_s"):
        score += 1
    return score, title.lower()


def _best_track_entry(coord: dict[str, Any], by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Coordinator controls playback; track metadata may live on a group member."""
    best = coord
    best_score = _track_richness(best)
    for uid in coord.get("member_uids") or []:
        member = by_id.get(str(uid))
        if member is None:
            continue
        score = _track_richness(member)
        if score > best_score:
            best = member
            best_score = score
    return best


def _select_active_coord_ids(speakers: list[dict[str, Any]], by_id: dict[str, dict[str, Any]]) -> list[str]:
    clusters: dict[str, dict[str, Any]] = {}
    for entry in speakers:
        if not entry["active"]:
            continue
        coord_id = entry["coordinator_id"]
        if coord_id not in clusters:
            clusters[coord_id] = by_id.get(coord_id, entry)

    return sorted(
        clusters.keys(),
        key=lambda coord_id: (
            _track_richness(_best_track_entry(clusters[coord_id], by_id)),
            clusters[coord_id]["name"].lower(),
        ),
        reverse=True,
    )


def _now_playing_payload(coord_id: str, by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    coord = by_id[coord_id]
    track = _best_track_entry(coord, by_id)
    return {
        "id": coord["id"],
        "coordinator_id": coord_id,
        "name": coord["name"],
        "playing": coord["playing"],
        "paused": coord["paused"],
        "title": _track_title(track),
        "artist": track.get("artist") or "",
        "track_title": track.get("title") or "",
        "position_s": track.get("position_s"),
        "duration_s": track.get("duration_s"),
        "volume": coord.get("volume"),
        "muted": coord.get("muted"),
        "cover_url": track.get("cover_url") or "",
        "has_cover": bool(track.get("cover_url")),
        "cover_device_id": track.get("id") or coord["id"],
        "is_coordinator": coord.get("is_coordinator"),
        "group_size": coord.get("group_size") or 1,
    }


def get_panel_audio() -> dict[str, Any]:
    from sonos_cache import get_unified_devices, refresh_sonos_cache

    refresh_sonos_cache()

    data = get_unified_devices()
    speakers: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    for row in data.get("rows", []):
        if row.get("source") != "sonos":
            continue
        entry = _speaker_entry(row)
        if not entry["id"]:
            continue
        speakers.append(entry)
        by_id[entry["id"]] = entry

    speakers.sort(key=lambda item: (0 if item["active"] else 1, item["name"].lower()))

    active_coord_ids = _select_active_coord_ids(speakers, by_id)

    sessions: list[dict[str, Any]] = []
    now_playing: dict[str, Any] | None = None
    group_members: list[dict[str, Any]] = []
    member_ids: set[str] = set()

    for active_coord_id in active_coord_ids:
        if active_coord_id not in by_id:
            continue
        payload = _now_playing_payload(active_coord_id, by_id)
        sessions.append(payload)

    if sessions:
        now_playing = sessions[0]
        active_coord_id = sessions[0]["coordinator_id"]
        coord = by_id[active_coord_id]

        if (coord.get("group_size") or 1) > 1:
            for uid in coord.get("member_uids") or []:
                member = by_id.get(uid)
                if member is None:
                    continue
                member_ids.add(uid)
                group_members.append(
                    {
                        "id": member["id"],
                        "name": member["name"],
                        "volume": member.get("volume"),
                        "muted": member.get("muted"),
                        "is_coordinator": member["id"] == active_coord_id,
                    }
                )
            group_members.sort(
                key=lambda item: (0 if item["is_coordinator"] else 1, item["name"].lower())
            )
            group_members = group_members[:PANEL_GROUP_MEMBERS]
            member_ids.update(item["id"] for item in group_members)

    for session in sessions:
        coord = by_id.get(session["coordinator_id"])
        if not coord:
            continue
        member_ids.add(session["coordinator_id"])
        for uid in coord.get("member_uids") or []:
            member_ids.add(str(uid))

    others: list[dict[str, Any]] = []
    for entry in speakers:
        if entry["id"] in member_ids:
            continue
        others.append({"id": entry["id"], "name": entry["name"]})
    others.sort(key=lambda item: item["name"].lower())
    others = others[:PANEL_AUDIO_OTHERS]

    active: dict[str, Any] | None = None
    if sessions:
        if len(sessions) == 1:
            active = {
                "id": sessions[0]["id"],
                "name": sessions[0]["name"],
                "status": sessions[0]["title"],
                "playing": sessions[0]["playing"],
            }
        else:
            active = {
                "id": sessions[0]["id"],
                "name": f"{len(sessions)} Wiedergaben",
                "status": sessions[0]["title"],
                "playing": any(s["playing"] for s in sessions),
            }

    legacy_speakers = [
        {
            "id": s["id"],
            "name": s["name"],
            "status": s["status"],
            "playing": s["playing"],
        }
        for s in speakers[:6]
    ]

    summary = ""
    if active:
        if len(sessions) > 1:
            summary = f"▶ {len(sessions)} Wiedergaben aktiv"
        else:
            summary = f"▶ {active['name']}: {active['status']}"

    return {
        "updated_at": time.time(),
        "count": len(speakers),
        "summary": summary,
        "active": active,
        "now_playing": now_playing,
        "sessions": sessions,
        "group_members": group_members,
        "others": others,
        "speakers": legacy_speakers,
        "errors": data.get("sonos_errors") or [],
    }
