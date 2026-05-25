"""Sonos local network control via SoCo (UPnP/SSDP discovery)."""

from __future__ import annotations

import os
from typing import Any

import soco
from soco.exceptions import SoCoException, SoCoUPnPException

PLAYING_STATES = {"PLAYING", "TRANSITIONING"}


class SonosError(RuntimeError):
    pass


def is_enabled() -> bool:
    return os.environ.get("SONOS_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}


def _configured_ips() -> list[str]:
    raw = os.environ.get("SONOS_IP", "").strip()
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def _discovery_timeout() -> int:
    try:
        return max(2, int(os.environ.get("SONOS_DISCOVERY_TIMEOUT", "5")))
    except ValueError:
        return 5


_last_discovered_ips: list[str] = []


def _speakers_from_ips(ips: list[str]) -> list[soco.SoCo]:
    speakers: list[soco.SoCo] = []
    for ip in ips:
        address = str(ip or "").strip()
        if not address:
            continue
        try:
            speakers.append(soco.SoCo(address))
        except (SoCoException, OSError):
            continue
    return sorted(speakers, key=lambda speaker: speaker.player_name.lower())


def discover_speakers() -> list[soco.SoCo]:
    global _last_discovered_ips
    ips = _configured_ips()
    if ips:
        speakers = _speakers_from_ips(ips)
        if speakers:
            _last_discovered_ips = [str(speaker.ip_address) for speaker in speakers if speaker.ip_address]
        return speakers

    found = soco.discover(timeout=_discovery_timeout())
    if found:
        speakers = sorted(found, key=lambda speaker: speaker.player_name.lower())
        _last_discovered_ips = [str(speaker.ip_address) for speaker in speakers if speaker.ip_address]
        return speakers

    if _last_discovered_ips:
        speakers = _speakers_from_ips(_last_discovered_ips)
        if speakers:
            return speakers

    return []


def _speaker_by_uid(uid: str) -> soco.SoCo:
    for speaker in discover_speakers():
        if speaker.uid == uid:
            return speaker
    raise SonosError(f"Sonos-Gerät nicht gefunden: {uid}")


def _group_coordinator(speaker: soco.SoCo) -> soco.SoCo:
    group = getattr(speaker, "group", None)
    if group is not None:
        coordinator = getattr(group, "coordinator", None)
        if coordinator is not None:
            return coordinator
    return speaker


def _transport_state(speaker: soco.SoCo) -> str:
    try:
        transport = speaker.get_current_transport_info() or {}
        return str(transport.get("current_transport_state") or "STOPPED").upper()
    except (SoCoException, OSError):
        return "UNKNOWN"


def _ignore_unavailable_transition(exc: Exception) -> None:
    message = str(exc)
    if isinstance(exc, SoCoUPnPException) and "701" in message:
        return
    raise exc


def _safe_play(speaker: soco.SoCo) -> None:
    target = _group_coordinator(speaker)
    state = _transport_state(target)
    if state in PLAYING_STATES:
        return
    try:
        target.play()
    except (SoCoException, OSError) as exc:
        _ignore_unavailable_transition(exc)


def _safe_pause(speaker: soco.SoCo) -> None:
    target = _group_coordinator(speaker)
    state = _transport_state(target)
    if state not in PLAYING_STATES:
        return
    try:
        target.pause()
    except (SoCoException, OSError) as exc:
        _ignore_unavailable_transition(exc)


def _safe_stop(speaker: soco.SoCo) -> None:
    target = _group_coordinator(speaker)
    try:
        target.stop()
    except (SoCoException, OSError) as exc:
        _ignore_unavailable_transition(exc)


def _parse_time_to_seconds(value: str | None) -> int | None:
    if not value or value == "NOT_IMPLEMENTED":
        return None
    parts = str(value).strip().split(":")
    try:
        nums = [int(part) for part in parts]
    except ValueError:
        return None
    if len(nums) == 3:
        return nums[0] * 3600 + nums[1] * 60 + nums[2]
    if len(nums) == 2:
        return nums[0] * 60 + nums[1]
    return None


def _seconds_to_seek_time(seconds: int) -> str:
    total = max(0, int(seconds))
    hours = total // 3600
    minutes = (total % 3600) // 60
    secs = total % 60
    return f"{hours}:{minutes:02d}:{secs:02d}"


def speaker_snapshot(speaker: soco.SoCo) -> dict[str, Any]:
    try:
        transport = speaker.get_current_transport_info() or {}
    except (SoCoException, OSError) as exc:
        transport = {"current_transport_state": "UNAVAILABLE", "error": str(exc)}

    try:
        track = speaker.get_current_track_info() or {}
    except (SoCoException, OSError):
        track = {}

    try:
        volume = int(speaker.volume)
    except (SoCoException, OSError, TypeError, ValueError):
        volume = None

    try:
        muted = bool(speaker.mute)
    except (SoCoException, OSError):
        muted = False

    state = str(transport.get("current_transport_state") or "STOPPED").upper()
    model = getattr(speaker, "model_name", None) or getattr(speaker, "model_number", None)

    group_info: dict[str, Any] = {
        "coordinator_uid": None,
        "is_coordinator": False,
        "member_uids": [],
        "member_names": [],
    }
    group = getattr(speaker, "group", None)
    if group is not None:
        coordinator = getattr(group, "coordinator", None)
        if coordinator is not None:
            group_info["coordinator_uid"] = coordinator.uid
            group_info["is_coordinator"] = speaker.uid == coordinator.uid
        members = getattr(group, "members", None) or []
        group_info["member_uids"] = [member.uid for member in members]
        group_info["member_names"] = [member.player_name for member in members]

    position_raw = str(track.get("position") or "").strip()
    duration_raw = str(track.get("duration") or "").strip()
    position_s = _parse_time_to_seconds(position_raw)
    duration_s = _parse_time_to_seconds(duration_raw)

    return {
        "uid": speaker.uid,
        "name": speaker.player_name,
        "ip": speaker.ip_address,
        "model": model or "Sonos",
        "volume": volume,
        "muted": muted,
        "transport_state": state,
        "is_playing": state in PLAYING_STATES,
        "track": {
            "title": (track.get("title") or "").strip(),
            "artist": (track.get("artist") or "").strip(),
            "album": (track.get("album") or "").strip(),
            "album_art": (track.get("album_art") or "").strip() or None,
            "position": position_raw or None,
            "duration": duration_raw or None,
            "position_s": position_s,
            "duration_s": duration_s,
        },
        "group": group_info,
    }


def list_speakers() -> list[dict[str, Any]]:
    if not is_enabled():
        return []
    return [speaker_snapshot(speaker) for speaker in discover_speakers()]


def list_speakers_from_catalog(catalog: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Bekannte IPs aus dem Cache nutzen, wenn SSDP gerade nichts findet."""
    ips = [str(item.get("ip") or "").strip() for item in catalog if item.get("ip")]
    speakers = _speakers_from_ips(ips)
    return [speaker_snapshot(speaker) for speaker in speakers]


def _clear_zone_group_cache(*speakers: soco.SoCo) -> None:
    for speaker in speakers:
        cache = getattr(speaker, "zone_group_state", None)
        if cache is not None:
            cache.clear_cache()


def _delegate_coordinator(current_coordinator: soco.SoCo, new_coordinator: soco.SoCo) -> bool:
    """Koordination übergeben; True wenn DelegateGroupCoordinationTo geklappt hat."""
    group = getattr(current_coordinator, "group", None)
    members = list(getattr(group, "members", None) or []) if group is not None else []
    if len(members) <= 1:
        raise SonosError("Keine Gruppe zum Wechseln")
    if current_coordinator.uid == new_coordinator.uid:
        return False

    delegated = False
    try:
        current_coordinator.avTransport.DelegateGroupCoordinationTo(
            [
                ("InstanceID", 0),
                ("NewCoordinator", new_coordinator.uid),
                ("RejoinGroup", 1),
            ]
        )
        delegated = True
    except (SoCoException, OSError):
        for member in members:
            if member.uid != new_coordinator.uid:
                try:
                    member.join(new_coordinator)
                except (SoCoException, OSError):
                    pass

    for device in (current_coordinator, new_coordinator):
        if hasattr(device, "zone_group_state"):
            device.zone_group_state.clear_cache()
    return delegated


def _unjoin_other_members(keeper: soco.SoCo) -> list[str]:
    """Alle Gruppenmitglieder außer keeper aus der Gruppe entfernen."""
    coordinator = _group_coordinator(keeper)
    group = getattr(coordinator, "group", None)
    members = list(getattr(group, "members", None) or []) if group is not None else []
    removed: list[str] = []
    for member in members:
        if member.uid == keeper.uid:
            continue
        try:
            member.unjoin()
            removed.append(member.uid)
        except (SoCoException, OSError):
            pass
    _clear_zone_group_cache(keeper)
    if group is not None:
        _clear_zone_group_cache(*list(getattr(group, "members", None) or []))
    return removed


def control_speaker(uid: str, action: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = payload or {}
    speaker = _speaker_by_uid(uid)

    if action == "turnOn":
        _safe_play(speaker)
        return {"ok": True, "source": "sonos", "device_id": uid, "command": "play"}

    if action == "turnOff":
        _safe_pause(speaker)
        return {"ok": True, "source": "sonos", "device_id": uid, "command": "pause"}

    if action == "toggle":
        target = _group_coordinator(speaker)
        state = _transport_state(target)
        if state in PLAYING_STATES:
            _safe_pause(speaker)
            command = "pause"
        else:
            _safe_play(speaker)
            command = "play"
        return {"ok": True, "source": "sonos", "device_id": uid, "command": command}

    if action == "set":
        if "volume" in payload:
            volume = int(payload["volume"])
            if volume < 0 or volume > 100:
                raise ValueError("volume muss zwischen 0 und 100 liegen")
            speaker.volume = volume
        if "mute" in payload:
            speaker.mute = bool(payload["mute"])
        return {
            "ok": True,
            "source": "sonos",
            "device_id": uid,
            "command": "set",
            "volume": getattr(speaker, "volume", None),
            "muted": getattr(speaker, "mute", None),
        }

    if action == "stop":
        _safe_stop(speaker)
        return {"ok": True, "source": "sonos", "device_id": uid, "command": "stop"}

    if action == "next":
        _group_coordinator(speaker).next()
        return {"ok": True, "source": "sonos", "device_id": uid, "command": "next"}

    if action == "previous":
        _group_coordinator(speaker).previous()
        return {"ok": True, "source": "sonos", "device_id": uid, "command": "previous"}

    if action == "seek":
        position = payload.get("position")
        if position is None:
            raise ValueError("position erforderlich")
        if isinstance(position, (int, float)):
            seek_time = _seconds_to_seek_time(int(position))
        else:
            seek_time = str(position).strip()
            if _parse_time_to_seconds(seek_time) is None:
                raise ValueError("position muss Sekunden oder H:MM:SS sein")
        try:
            _group_coordinator(speaker).seek(position=seek_time)
        except (SoCoException, OSError) as exc:
            _ignore_unavailable_transition(exc)
        return {
            "ok": True,
            "source": "sonos",
            "device_id": uid,
            "command": "seek",
            "position": seek_time,
        }

    if action == "join":
        coordinator_uid = str(payload.get("coordinator_uid") or "").strip()
        if not coordinator_uid:
            raise ValueError("coordinator_uid erforderlich")
        coordinator = _speaker_by_uid(coordinator_uid)
        if speaker.uid == coordinator.uid:
            return {"ok": True, "source": "sonos", "device_id": uid, "command": "join", "skipped": True}
        speaker.join(coordinator)
        _clear_zone_group_cache(speaker, coordinator)
        group = getattr(coordinator, "group", None)
        if group is not None:
            _clear_zone_group_cache(*list(getattr(group, "members", None) or []))
        return {
            "ok": True,
            "source": "sonos",
            "device_id": uid,
            "command": "join",
            "coordinator_uid": coordinator_uid,
        }

    if action == "unjoin":
        speaker.unjoin()
        _clear_zone_group_cache(speaker)
        group = getattr(speaker, "group", None)
        if group is not None:
            _clear_zone_group_cache(*list(getattr(group, "members", None) or []))
        return {"ok": True, "source": "sonos", "device_id": uid, "command": "unjoin"}

    if action == "takeover_group":
        coordinator = _group_coordinator(speaker)
        group = getattr(coordinator, "group", None)
        members = list(getattr(group, "members", None) or []) if group is not None else []
        if len(members) <= 1:
            return {
                "ok": True,
                "source": "sonos",
                "device_id": uid,
                "command": "takeover_group",
                "skipped": True,
            }

        delegated = False
        if coordinator.uid != speaker.uid:
            delegated = _delegate_coordinator(coordinator, speaker)
            coordinator = _group_coordinator(speaker)

        removed = _unjoin_other_members(speaker)
        return {
            "ok": True,
            "source": "sonos",
            "device_id": uid,
            "command": "takeover_group",
            "coordinator_uid": speaker.uid,
            "delegated": delegated,
            "removed_members": removed,
        }

    if action == "transfer":
        target_uid = str(payload.get("target_uid") or "").strip()
        if not target_uid:
            raise ValueError("target_uid erforderlich")
        target = _speaker_by_uid(target_uid)
        if speaker.uid == target.uid:
            return {
                "ok": True,
                "source": "sonos",
                "device_id": uid,
                "command": "transfer",
                "target_uid": target_uid,
                "skipped": True,
            }

        coordinator = _group_coordinator(speaker)
        if target.uid == coordinator.uid:
            return {
                "ok": True,
                "source": "sonos",
                "device_id": uid,
                "command": "transfer",
                "target_uid": target_uid,
                "skipped": True,
            }

        target.join(coordinator)
        group = getattr(coordinator, "group", None)
        if group is not None:
            for member in list(getattr(group, "members", None) or []):
                if member.uid != target.uid:
                    try:
                        member.unjoin()
                    except (SoCoException, OSError):
                        pass
        if hasattr(target, "zone_group_state"):
            target.zone_group_state.clear_cache()
        return {
            "ok": True,
            "source": "sonos",
            "device_id": uid,
            "command": "transfer",
            "target_uid": target_uid,
            "coordinator_uid": coordinator.uid,
        }

    if action == "promote_coordinator":
        new_coordinator_uid = str(payload.get("coordinator_uid") or "").strip()
        if not new_coordinator_uid:
            raise ValueError("coordinator_uid erforderlich")
        new_coordinator = _speaker_by_uid(new_coordinator_uid)
        coordinator = _group_coordinator(speaker)
        if coordinator.uid == new_coordinator.uid:
            return {
                "ok": True,
                "source": "sonos",
                "device_id": uid,
                "command": "promote_coordinator",
                "coordinator_uid": new_coordinator_uid,
                "skipped": True,
            }

        delegated = _delegate_coordinator(coordinator, new_coordinator)
        return {
            "ok": True,
            "source": "sonos",
            "device_id": uid,
            "command": "promote_coordinator",
            "coordinator_uid": new_coordinator_uid,
            "delegated": delegated,
        }

    raise ValueError(f"Unbekannte Sonos-Aktion: {action}")


def get_connection_status() -> dict[str, Any]:
    if not is_enabled():
        return {"enabled": False, "configured": False, "speaker_count": 0}
    try:
        speakers = discover_speakers()
        return {
            "enabled": True,
            "configured": bool(_configured_ips()),
            "speaker_count": len(speakers),
            "names": [speaker.player_name for speaker in speakers],
        }
    except (SonosError, SoCoException, OSError) as exc:
        return {
            "enabled": True,
            "configured": bool(_configured_ips()),
            "speaker_count": 0,
            "error": str(exc),
        }
