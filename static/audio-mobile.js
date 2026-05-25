const POLL_MS = 3000;
const TICK_MS = 1000;
const DRAG_HOLD_MS = 280;

const ICONS = {
  play: '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  pause:
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M6 18l8.5-6L6 6v12zM18 6h2v12h-2z"/></svg>',
  mute:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
  unmute:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 010 7.07"/><path d="M19.07 4.93a10 10 0 010 14.14"/></svg>',
  leave:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  takeover:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5h4"/><path d="M5 19h4"/><path d="M9 5v14"/><line x1="9" y1="12" x2="21" y2="12"/><polyline points="18 9 21 12 18 15"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  refresh:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 11-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>',
  grip:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
};

const state = {
  panel: null,
  devices: [],
  scrubCoordId: null,
  pollInFlight: false,
  playbackClocks: {},
  coverKeys: {},
  drag: null,
  dropBound: false,
};

const $ = (id) => document.getElementById(id);

function iconBtn(iconHtml, title, onClick, { danger = false, className = "m-audio-icon-btn" } = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `${className}${danger ? " danger" : ""}`;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.innerHTML = iconHtml;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function fmtTime(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return "0:00";
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function deviceKey(d) {
  return `${d.source || "sonos"}:${d.device_id}`;
}

function parseKey(key) {
  const idx = key.indexOf(":");
  return idx === -1 ? ["sonos", key] : [key.slice(0, idx), key.slice(idx + 1)];
}

function groupInfo(d) {
  return d?.group || {};
}

function clusterCoordId(device) {
  const g = groupInfo(device);
  return g.coordinator_uid || device.device_id;
}

function isDeviceActive(device) {
  return Boolean(device?.is_playing) || device?.transport_state === "PAUSED_PLAYBACK";
}

function clusterMembers(devices, coordId) {
  return devices.filter((d) => clusterCoordId(d) === coordId);
}

function sortMembers(members, coordinator) {
  return [...members].sort((a, b) => {
    if (a.device_id === coordinator.device_id) return -1;
    if (b.device_id === coordinator.device_id) return 1;
    return (a.name || "").localeCompare(b.name || "", "de");
  });
}

function buildClusters(devices) {
  const clusters = new Map();
  for (const device of devices) {
    const coordId = clusterCoordId(device);
    if (!clusters.has(coordId)) clusters.set(coordId, []);
    clusters.get(coordId).push(device);
  }
  const grouped = [];
  const solo = [];
  for (const [, members] of clusters) {
    if (members.length > 1) grouped.push(members);
    else solo.push(members[0]);
  }
  grouped.sort((a, b) => (a[0]?.name || "").localeCompare(b[0]?.name || "", "de"));
  solo.sort((a, b) => (a.name || "").localeCompare(b.name || "", "de"));
  return { grouped, solo };
}

function trackRichness(device) {
  const track = device?.track || {};
  let score = 0;
  if (track.title) score += 4;
  if (track.artist) score += 2;
  if (track.album_art) score += 2;
  if (track.duration_s) score += 1;
  return score;
}

function bestTrackDevice(members) {
  return members.reduce((best, member) => (trackRichness(member) > trackRichness(best) ? member : best), members[0]);
}

function trackLabel(device) {
  const track = device?.track || {};
  if (isDeviceActive(device) && track.title && track.artist) return `${track.artist} – ${track.title}`;
  if (isDeviceActive(device) && track.title) return track.title;
  if (device?.transport_state === "PAUSED_PLAYBACK") return "Pausiert";
  if (device?.is_playing) return "Wiedergabe";
  return "Bereit";
}

function sessionPayload(coordinator, members) {
  const trackDevice = bestTrackDevice(members);
  const track = trackDevice?.track || {};
  const coordId = clusterCoordId(coordinator);
  return {
    id: coordinator.device_id,
    coordinator_id: coordId,
    name: coordinator.name || "Sonos",
    playing: Boolean(coordinator.is_playing),
    paused: coordinator.transport_state === "PAUSED_PLAYBACK",
    title: trackLabel(trackDevice),
    artist: track.artist || "",
    track_title: track.title || "",
    position_s: track.position_s,
    duration_s: track.duration_s,
    volume: coordinator.volume,
    muted: Boolean(coordinator.muted),
    cover_url: track.album_art || "",
    has_cover: Boolean(track.album_art),
    cover_device_id: trackDevice.device_id,
    group_size: members.length,
  };
}

function activeSessions(devices) {
  const { grouped, solo } = buildClusters(devices);
  const sessions = [];

  for (const members of grouped) {
    if (!members.some(isDeviceActive)) continue;
    const coordinator = members.find((m) => groupInfo(m).is_coordinator) || members[0];
    sessions.push({ coordinator, members, np: sessionPayload(coordinator, members) });
  }

  for (const device of solo) {
    if (!isDeviceActive(device)) continue;
    sessions.push({ coordinator: device, members: [device], np: sessionPayload(device, [device]) });
  }

  sessions.sort((a, b) => {
    const diff = trackRichness(bestTrackDevice(b.members)) - trackRichness(bestTrackDevice(a.members));
    if (diff !== 0) return diff;
    return (a.coordinator.name || "").localeCompare(b.coordinator.name || "", "de");
  });

  return sessions;
}

function activeCoordIds(sessions) {
  return new Set(sessions.map((s) => s.np.coordinator_id));
}

async function sonosAction(deviceId, action, payload = null) {
  const opts = { method: "POST" };
  if (payload) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(payload);
  }
  const res = await fetch(`/api/devices/all/sonos/${encodeURIComponent(deviceId)}/${action}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Aktion fehlgeschlagen");
  return data;
}

async function runAction(fn, { onError, refresh = true } = {}) {
  try {
    await fn();
    if (refresh) await poll(true);
  } catch (err) {
    showError(err.message);
    onError?.();
  }
}

function patchDevice(deviceId, patch) {
  const row = state.devices.find((d) => d.device_id === deviceId);
  if (row) Object.assign(row, patch);
}

function cloneGroup(device) {
  const g = groupInfo(device);
  return {
    coordinator_uid: g.coordinator_uid || device.device_id,
    is_coordinator: Boolean(g.is_coordinator),
    member_uids: [...(g.member_uids || [])],
    member_names: [...(g.member_names || [])],
  };
}

function optimisticUnjoin(deviceId) {
  const device = state.devices.find((d) => d.device_id === deviceId);
  if (!device) return null;

  const snapshot = state.devices.map((d) => ({
    device_id: d.device_id,
    group: cloneGroup(d),
  }));

  const coordId = clusterCoordId(device);
  const members = clusterMembers(state.devices, coordId);
  const remaining = members.filter((m) => m.device_id !== deviceId);

  patchDevice(deviceId, {
    group: {
      coordinator_uid: deviceId,
      is_coordinator: true,
      member_uids: [deviceId],
      member_names: [device.name || ""],
    },
  });

  if (remaining.length <= 1) {
    for (const m of remaining) {
      patchDevice(m.device_id, {
        group: {
          coordinator_uid: m.device_id,
          is_coordinator: true,
          member_uids: [m.device_id],
          member_names: [m.name || ""],
        },
      });
    }
  } else {
    const memberUids = remaining.map((m) => m.device_id);
    const memberNames = remaining.map((m) => m.name || "");
    for (const m of remaining) {
      patchDevice(m.device_id, {
        group: {
          coordinator_uid: coordId,
          is_coordinator: m.device_id === coordId,
          member_uids: memberUids,
          member_names: memberNames,
        },
      });
    }
  }

  if (state.panel) render(state.panel, state.devices);
  return snapshot;
}

function rollbackUnjoin(snapshot) {
  if (!snapshot) return;
  for (const item of snapshot) {
    patchDevice(item.device_id, { group: item.group });
  }
  if (state.panel) render(state.panel, state.devices);
}

function leaveGroup(deviceId) {
  const snapshot = optimisticUnjoin(deviceId);
  return runAction(() => sonosAction(deviceId, "unjoin"), {
    onError: () => rollbackUnjoin(snapshot),
  });
}

function setMuteButton(btn, muted) {
  btn.innerHTML = muted ? ICONS.mute : ICONS.unmute;
  btn.setAttribute("aria-label", muted ? "Stumm aus" : "Stumm");
}

function showError(msg) {
  const el = $("m-audio-error");
  if (!msg) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = msg;
  el.classList.remove("hidden");
}

function sessionCoverKey(np) {
  const id = np?.cover_device_id || np?.coordinator_id || np?.id;
  const trackTag = [
    np?.track_title || "",
    np?.artist || "",
    (np?.cover_url || "").trim(),
  ].join("\0");
  return `${id}:${trackTag}`;
}

function coverImageSrc(np) {
  const id = np?.cover_device_id || np?.coordinator_id || np?.id;
  const directUrl = (np?.cover_url || "").trim();
  if (!id) return directUrl;
  const bust = encodeURIComponent([np?.track_title || "", np?.artist || ""].join(" – ") || "track");
  return `/api/panel/audio/cover?device_id=${encodeURIComponent(id)}&t=${bust}`;
}

function membersFingerprint(members) {
  return members
    .map((m) => m.device_id)
    .sort()
    .join(",");
}

function syncSessionClock(np, coordId) {
  if (np?.playing && np.position_s != null && np.duration_s != null && np.duration_s > 0) {
    state.playbackClocks[coordId] = {
      position: np.position_s,
      duration: np.duration_s,
      syncedAt: Date.now(),
    };
  } else {
    delete state.playbackClocks[coordId];
  }
}

function sessionPosition(np, coordId, scrubEl) {
  if (state.scrubCoordId === coordId && scrubEl) return Number(scrubEl.value);
  const clock = state.playbackClocks[coordId];
  if (clock && np?.playing) {
    const elapsed = (Date.now() - clock.syncedAt) / 1000;
    return Math.min(clock.position + elapsed, clock.duration);
  }
  return np?.position_s ?? 0;
}

function tickPlayback() {
  if (state.scrubCoordId) return;
  for (const sessionEl of document.querySelectorAll(".m-audio-session")) {
    const coordId = sessionEl.dataset.coordinatorId;
    const clock = state.playbackClocks[coordId];
    if (!clock) continue;
    const scrub = sessionEl.querySelector(".m-audio-scrub");
    const posEl = sessionEl.querySelector(".m-audio-pos");
    if (!scrub || !posEl) continue;
    const elapsed = (Date.now() - clock.syncedAt) / 1000;
    const pos = Math.min(clock.position + elapsed, clock.duration);
    scrub.value = String(Math.floor(pos));
    posEl.textContent = fmtTime(pos);
  }
}

function setCoverOn(np, cover, ph, coordId) {
  const key = sessionCoverKey(np);
  const directUrl = (np?.cover_url || "").trim();
  const id = np?.cover_device_id || np?.coordinator_id || np?.id;
  const hasCover = Boolean(directUrl || np?.has_cover || id);
  const nextSrc = hasCover ? coverImageSrc(np) || directUrl : "";

  if (!hasCover || !nextSrc) {
    delete state.coverKeys[coordId];
    cover.classList.remove("is-loaded");
    cover.removeAttribute("src");
    ph.classList.remove("hidden");
    return;
  }

  if (key === state.coverKeys[coordId] && cover.classList.contains("is-loaded") && cover.getAttribute("src") === nextSrc) {
    return;
  }

  state.coverKeys[coordId] = key;
  cover.alt = np.track_title || np.title || "Cover";

  const show = () => {
    cover.classList.add("is-loaded");
    ph.classList.add("hidden");
  };
  const hide = () => {
    cover.classList.remove("is-loaded");
    ph.classList.remove("hidden");
  };

  cover.onload = show;
  cover.onerror = () => {
    if (directUrl && !cover.dataset.fallback) {
      cover.dataset.fallback = "1";
      cover.src = directUrl;
      return;
    }
    hide();
  };

  delete cover.dataset.fallback;
  cover.classList.remove("is-loaded");
  cover.src = nextSrc;
  if (cover.complete && cover.naturalWidth > 0) show();
}

function createDragHandle(key, label) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "m-audio-drag-handle";
  handle.innerHTML = ICONS.grip;
  handle.setAttribute("aria-label", `${label} verschieben`);
  setupDraggable(handle, key, label);
  return handle;
}

function activeMemberRow(member, coordinator) {
  const li = document.createElement("li");
  li.className = "m-audio-member-row";
  li.dataset.deviceKey = deviceKey(member);

  li.appendChild(createDragHandle(deviceKey(member), member.name));

  const name = document.createElement("span");
  name.className = "m-audio-member-name";
  name.textContent = member.name + (member.device_id === coordinator.device_id ? " ★" : "");
  li.appendChild(name);

  const volWrap = document.createElement("div");
  volWrap.className = "m-audio-member-vol-wrap";
  const vol = document.createElement("input");
  vol.type = "range";
  vol.className = "m-audio-member-vol";
  vol.min = "0";
  vol.max = "100";
  vol.value = String(member.volume ?? 0);
  vol.setAttribute("aria-label", `Lautstärke ${member.name}`);
  vol.addEventListener("input", () => patchDevice(member.device_id, { volume: Number(vol.value) }));
  vol.addEventListener("change", () => {
    const value = Number(vol.value);
    const prev = member.volume ?? 0;
    patchDevice(member.device_id, { volume: value });
    runAction(() => sonosAction(member.device_id, "set", { volume: value }), {
      onError: () => {
        vol.value = String(prev);
        patchDevice(member.device_id, { volume: prev });
      },
    });
  });
  volWrap.appendChild(vol);
  li.appendChild(volWrap);

  let muted = Boolean(member.muted);
  const mute = iconBtn(muted ? ICONS.mute : ICONS.unmute, muted ? "Stumm aus" : "Stumm", () => {
    const prev = muted;
    muted = !muted;
    setMuteButton(mute, muted);
    patchDevice(member.device_id, { muted });
    runAction(() => sonosAction(member.device_id, "set", { mute: muted }), {
      onError: () => {
        muted = prev;
        setMuteButton(mute, muted);
        patchDevice(member.device_id, { muted: prev });
      },
    });
  });
  li.appendChild(mute);

  const actions = document.createElement("div");
  actions.className = "m-audio-member-actions";
  if (member.device_id !== coordinator.device_id) {
    actions.appendChild(
      iconBtn(
        ICONS.star,
        "Koordinator machen",
        () =>
          runAction(() =>
            sonosAction(coordinator.device_id, "promote_coordinator", {
              coordinator_uid: member.device_id,
            })
          ),
        { className: "m-audio-icon-btn m-audio-promote-btn" }
      )
    );
    actions.appendChild(
      iconBtn(ICONS.leave, "Gruppe verlassen", () => leaveGroup(member.device_id), {
        danger: true,
        className: "m-audio-icon-btn m-audio-leave-btn",
      })
    );
  }
  li.appendChild(actions);

  li.appendChild(
    iconBtn(ICONS.takeover, "Gruppe entlassen", () => runAction(() => sonosAction(member.device_id, "takeover_group")), {
      danger: true,
      className: "m-audio-icon-btn m-audio-takeover-btn",
    })
  );
  return li;
}

function otherRow(device) {
  const row = document.createElement("div");
  row.className = "m-audio-other-row";
  row.dataset.deviceKey = deviceKey(device);
  row.appendChild(createDragHandle(deviceKey(device), device.name));
  const name = document.createElement("span");
  name.className = "m-audio-other-name";
  name.textContent = device.name;
  row.appendChild(name);
  return row;
}

function createSessionBlock({ coordinator, members, np }) {
  const coordId = np.coordinator_id;
  const isGroup = members.length > 1;

  const section = document.createElement("section");
  section.className = "m-audio-session";
  section.dataset.coordinatorId = coordId;
  section.dataset.coverKey = sessionCoverKey(np);

  const box = document.createElement("div");
  box.className = "m-audio-active-box";

  const coverWrap = document.createElement("div");
  coverWrap.className = "m-audio-cover-wrap";
  const cover = document.createElement("img");
  cover.className = "m-audio-cover";
  cover.alt = "";
  cover.decoding = "async";
  const coverPh = document.createElement("div");
  coverPh.className = "m-audio-cover m-audio-cover-ph";
  coverPh.textContent = "♪";
  coverWrap.appendChild(cover);
  coverWrap.appendChild(coverPh);
  box.appendChild(coverWrap);

  const deviceLabel = document.createElement("p");
  deviceLabel.className = "m-audio-device";
  deviceLabel.textContent = isGroup ? `Gruppe · ${members.length} Lautsprecher` : np.name;
  box.appendChild(deviceLabel);

  const title = document.createElement("h2");
  title.className = "m-audio-title";
  title.textContent = np.track_title || np.title || "Unbekannt";
  box.appendChild(title);

  const artist = document.createElement("p");
  artist.className = "m-audio-artist";
  artist.textContent = np.artist || "";
  artist.classList.toggle("hidden", !np.artist);
  box.appendChild(artist);

  setCoverOn(np, cover, coverPh, coordId);

  const timeline = document.createElement("div");
  timeline.className = "m-audio-timeline";
  const scrub = document.createElement("input");
  scrub.type = "range";
  scrub.className = "m-audio-scrub";
  scrub.min = "0";
  scrub.max = String(Math.max(0, Math.floor(np.duration_s ?? 0)));
  scrub.value = String(Math.floor(sessionPosition(np, coordId)));
  scrub.setAttribute("aria-label", "Wiedergabeposition");
  scrub.addEventListener("pointerdown", () => {
    state.scrubCoordId = coordId;
  });
  scrub.addEventListener("input", () => {
    const posEl = section.querySelector(".m-audio-pos");
    if (posEl) posEl.textContent = fmtTime(Number(scrub.value));
  });
  scrub.addEventListener("pointerup", () => {
    state.scrubCoordId = null;
    const pos = Number(scrub.value);
    const prev = np.position_s ?? 0;
    runAction(() => sonosAction(np.id, "seek", { position: pos }), {
      onError: () => {
        scrub.value = String(Math.floor(prev));
        const posEl = section.querySelector(".m-audio-pos");
        if (posEl) posEl.textContent = fmtTime(prev);
      },
    });
  });
  const times = document.createElement("div");
  times.className = "m-audio-times";
  const posEl = document.createElement("span");
  posEl.className = "m-audio-pos";
  posEl.textContent = fmtTime(sessionPosition(np, coordId));
  const durEl = document.createElement("span");
  durEl.className = "m-audio-dur";
  durEl.textContent = fmtTime(np.duration_s ?? 0);
  times.appendChild(posEl);
  times.appendChild(durEl);
  timeline.appendChild(scrub);
  timeline.appendChild(times);
  box.appendChild(timeline);

  const transport = document.createElement("div");
  transport.className = "m-audio-transport";
  transport.appendChild(
    iconBtn(ICONS.prev, "Zurück", () => runAction(() => sonosAction(np.id, "previous")), {
      className: "m-audio-transport-btn",
    })
  );
  const toggle = iconBtn(np.playing ? ICONS.pause : ICONS.play, np.playing ? "Pause" : "Wiedergabe", () => {
    const wasPlaying = Boolean(np.playing);
    toggle.innerHTML = wasPlaying ? ICONS.play : ICONS.pause;
    toggle.setAttribute("aria-label", wasPlaying ? "Wiedergabe" : "Pause");
    runAction(() => sonosAction(np.id, "toggle"), {
      onError: () => {
        toggle.innerHTML = wasPlaying ? ICONS.pause : ICONS.play;
        toggle.setAttribute("aria-label", wasPlaying ? "Pause" : "Wiedergabe");
      },
    });
  }, { className: "m-audio-transport-btn m-audio-play" });
  transport.appendChild(toggle);
  transport.appendChild(
    iconBtn(ICONS.next, "Weiter", () => runAction(() => sonosAction(np.id, "next")), {
      className: "m-audio-transport-btn",
    })
  );
  box.appendChild(transport);

  if (!isGroup) {
    const soloVol = document.createElement("div");
    soloVol.className = "m-audio-volume";
    let muted = Boolean(np.muted);
    const muteBtn = iconBtn(muted ? ICONS.mute : ICONS.unmute, muted ? "Stumm aus" : "Stumm", () => {
      const prev = muted;
      muted = !muted;
      setMuteButton(muteBtn, muted);
      runAction(() => sonosAction(np.id, "set", { mute: muted }), {
        onError: () => {
          muted = prev;
          setMuteButton(muteBtn, muted);
        },
      });
    });
    soloVol.appendChild(muteBtn);
    const vol = document.createElement("input");
    vol.type = "range";
    vol.min = "0";
    vol.max = "100";
    vol.value = String(np.volume ?? 0);
    vol.setAttribute("aria-label", "Lautstärke");
    const volLabel = document.createElement("span");
    volLabel.className = "m-audio-vol-label";
    volLabel.textContent = `${np.volume ?? 0}%`;
    vol.addEventListener("input", () => {
      volLabel.textContent = `${vol.value}%`;
    });
    vol.addEventListener("change", () => {
      const value = Number(vol.value);
      const prev = np.volume ?? 0;
      runAction(() => sonosAction(np.id, "set", { volume: value }), {
        onError: () => {
          vol.value = String(prev);
          volLabel.textContent = `${prev}%`;
        },
      });
    });
    soloVol.appendChild(vol);
    soloVol.appendChild(volLabel);
    box.appendChild(soloVol);
  }

  section.appendChild(box);

  if (isGroup) {
    const membersEl = document.createElement("ul");
    membersEl.className = "m-audio-active-members";
    membersEl.dataset.sessionId = coordId;
    section.dataset.membersFp = membersFingerprint(members);
    for (const member of sortMembers(members, coordinator)) {
      membersEl.appendChild(activeMemberRow(member, coordinator));
    }
    section.appendChild(membersEl);
  }

  setupDropZone(section, async (key) => {
    const [, deviceId] = parseKey(key);
    if (!coordId || deviceId === coordId) return;
    const alreadyMember = members.some((m) => m.device_id === deviceId);
    if (alreadyMember) return;
    await runAction(() => sonosAction(deviceId, "join", { coordinator_uid: coordId }));
  });

  syncSessionClock(np, coordId);
  return section;
}

function updateSessionBlock(section, { coordinator, members, np }) {
  const coordId = np.coordinator_id;
  const isGroup = members.length > 1;

  section.querySelector(".m-audio-device").textContent = isGroup
    ? `Gruppe · ${members.length} Lautsprecher`
    : np.name;
  section.querySelector(".m-audio-title").textContent = np.track_title || np.title || "Unbekannt";

  const artist = section.querySelector(".m-audio-artist");
  artist.textContent = np.artist || "";
  artist.classList.toggle("hidden", !np.artist);

  const coverKey = sessionCoverKey(np);
  if (section.dataset.coverKey !== coverKey) {
    section.dataset.coverKey = coverKey;
    setCoverOn(np, section.querySelector("img.m-audio-cover"), section.querySelector(".m-audio-cover-ph"), coordId);
  }

  const scrub = section.querySelector(".m-audio-scrub");
  if (scrub && state.scrubCoordId !== coordId) {
    scrub.max = String(Math.max(0, Math.floor(np.duration_s ?? 0)));
    scrub.value = String(Math.floor(sessionPosition(np, coordId, scrub)));
  }
  if (state.scrubCoordId !== coordId) {
    const posEl = section.querySelector(".m-audio-pos");
    if (posEl) posEl.textContent = fmtTime(sessionPosition(np, coordId, scrub));
  }
  const durEl = section.querySelector(".m-audio-dur");
  if (durEl) durEl.textContent = fmtTime(np.duration_s ?? 0);

  const toggle = section.querySelector(".m-audio-play");
  if (toggle) {
    toggle.innerHTML = np.playing ? ICONS.pause : ICONS.play;
    toggle.setAttribute("aria-label", np.playing ? "Pause" : "Wiedergabe");
  }

  const soloVol = section.querySelector(".m-audio-volume");
  if (soloVol) {
    const vol = soloVol.querySelector('input[type="range"]');
    const volLabel = soloVol.querySelector(".m-audio-vol-label");
    const muteBtn = soloVol.querySelector(".m-audio-icon-btn");
    if (vol && document.activeElement !== vol) vol.value = String(np.volume ?? 0);
    if (volLabel) volLabel.textContent = `${np.volume ?? 0}%`;
    if (muteBtn) setMuteButton(muteBtn, Boolean(np.muted));
  }

  let membersEl = findSessionMembers(section, $("m-audio-groups"));
  const memberFp = membersFingerprint(members);
  if (isGroup) {
    if (!membersEl) {
      membersEl = document.createElement("ul");
      membersEl.className = "m-audio-active-members";
      membersEl.dataset.sessionId = coordId;
      const box = section.querySelector(".m-audio-active-box");
      if (box) box.after(membersEl);
      else section.appendChild(membersEl);
    }
    if (section.dataset.membersFp !== memberFp) {
      section.dataset.membersFp = memberFp;
      membersEl.innerHTML = "";
      for (const member of sortMembers(members, coordinator)) {
        membersEl.appendChild(activeMemberRow(member, coordinator));
      }
    }
  } else if (membersEl) {
    membersEl.remove();
    delete section.dataset.membersFp;
  }

  syncSessionClock(np, coordId);
}

function isLandscapeLayout() {
  return window.matchMedia("(min-aspect-ratio: 1/1)").matches;
}

function findSessionMembers(section, groupsEl) {
  const coordId = section.dataset.coordinatorId;
  return (
    section.querySelector(".m-audio-active-members") ||
    groupsEl?.querySelector(`.m-audio-active-members[data-session-id="${coordId}"]`) ||
    null
  );
}

function syncMembersPlacement() {
  const groupsEl = $("m-audio-groups");
  const sessionsEl = $("m-audio-sessions");
  if (!groupsEl || !sessionsEl) return;

  const landscape = isLandscapeLayout();
  const sections = [...sessionsEl.querySelectorAll(".m-audio-session")];
  const activeIds = new Set(sections.map((s) => s.dataset.coordinatorId));

  for (const el of [...groupsEl.querySelectorAll(".m-audio-active-members")]) {
    if (!activeIds.has(el.dataset.sessionId)) el.remove();
  }

  if (landscape) {
    for (const section of sections) {
      const membersEl = findSessionMembers(section, groupsEl);
      if (membersEl && membersEl.parentElement !== groupsEl) groupsEl.appendChild(membersEl);
    }
    return;
  }

  for (const section of sections) {
    const membersEl = findSessionMembers(section, groupsEl);
    if (!membersEl) continue;
    const box = section.querySelector(".m-audio-active-box");
    if (box && membersEl.parentElement !== section) box.after(membersEl);
  }
}

function renderSessions(devices) {
  const sessions = activeSessions(devices);
  const sessionsEl = $("m-audio-sessions");
  const existing = new Map(
    [...sessionsEl.querySelectorAll(".m-audio-session")].map((el) => [el.dataset.coordinatorId, el])
  );
  const nextIds = new Set();

  $("m-audio-empty").classList.toggle("hidden", sessions.length > 0 || devices.length === 0);

  for (const session of sessions) {
    const coordId = session.np.coordinator_id;
    nextIds.add(coordId);
    let el = existing.get(coordId);
    if (el) updateSessionBlock(el, session);
    else el = createSessionBlock(session);
    sessionsEl.appendChild(el);
  }

  for (const [coordId, el] of existing) {
    if (!nextIds.has(coordId)) {
      el.remove();
      delete state.coverKeys[coordId];
      delete state.playbackClocks[coordId];
    }
  }

  syncMembersPlacement();

  return sessions;
}

function renderOthers(devices, sessions) {
  const busyIds = new Set();
  for (const session of sessions) {
    for (const member of session.members) busyIds.add(member.device_id);
  }

  const others = devices
    .filter((d) => !busyIds.has(d.device_id))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "de"));

  const othersEl = $("m-audio-others");
  const showOthers = others.length > 0;
  othersEl.classList.toggle("hidden", !showOthers);
  $("m-audio-idle-divider")?.classList.toggle("hidden", !showOthers);

  const showDevicesCol = sessions.length > 0 || showOthers;
  $("m-audio-devices")?.classList.toggle("hidden", !showDevicesCol);

  const existing = new Map(
    [...othersEl.querySelectorAll(".m-audio-other-row")].map((el) => [el.dataset.deviceKey, el])
  );
  const nextKeys = new Set();

  for (const d of others) {
    const key = deviceKey(d);
    nextKeys.add(key);
    let row = existing.get(key);
    if (!row) {
      row = otherRow(d);
      othersEl.appendChild(row);
    } else {
      row.querySelector(".m-audio-other-name").textContent = d.name;
    }
  }

  for (const [key, row] of existing) {
    if (!nextKeys.has(key)) row.remove();
  }

  if (!state.dropBound) {
    setupDropZone(othersEl, async (key) => {
      const [, deviceId] = parseKey(key);
      await leaveGroup(deviceId);
    });
    state.dropBound = true;
  }
}

function buildSummary(sessions) {
  if (!sessions.length) return `${state.devices.length} Lautsprecher`;
  if (sessions.length === 1) {
    const np = sessions[0].np;
    return `▶ ${np.name}: ${np.track_title || np.title}`;
  }
  return `▶ ${sessions.length} Wiedergaben aktiv`;
}

function render(panel, devices) {
  state.panel = panel;
  state.devices = devices;
  document.body.classList.remove("m-audio-loading");

  const sessions = renderSessions(devices);
  renderOthers(devices, sessions);

  $("m-audio-meta").textContent = panel.summary || buildSummary(sessions);

  const errors = [...(panel.errors || []), ...(devices.sonos_errors || [])].filter(Boolean);
  showError(errors.length ? errors.join(" · ") : null);
}

async function poll(force = false) {
  if (state.pollInFlight && !force) return;
  state.pollInFlight = true;
  try {
    const [panelRes, devRes] = await Promise.all([fetch("/api/panel/audio"), fetch("/api/sonos/devices")]);
    const panel = await panelRes.json();
    const devPayload = await devRes.json();
    if (!panelRes.ok) throw new Error(panel.error || "Sonos nicht erreichbar");
    if (!devRes.ok) throw new Error(devPayload.error || "Geräte nicht geladen");
    devPayload.sonos_errors = devPayload.sonos_errors || [];
    render(panel, devPayload.rows || []);
  } catch (err) {
    showError(err.message);
  } finally {
    state.pollInFlight = false;
  }
}

function dropTargetAt(x, y) {
  const ghost = $("m-audio-drag-ghost");
  if (ghost) ghost.style.pointerEvents = "none";
  const el = document.elementFromPoint(x, y);
  if (ghost) ghost.style.pointerEvents = "";
  return el?.closest("[data-drop-bound='1'], [data-drop-target='1'], .m-audio-session");
}

function setupDropZone(zone, onDrop) {
  if (zone.dataset.dropBound === "1") return;
  zone.dataset.dropBound = "1";

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", async (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const key = e.dataTransfer?.getData("text/plain") || state.drag?.key;
    if (!key) return;
    try {
      await onDrop(key, zone);
    } catch (err) {
      showError(err.message);
    }
  });
}

function endPointerDrag() {
  const d = state.drag;
  if (!d) return;
  clearTimeout(d.holdTimer);
  document.removeEventListener("pointermove", d.onMove);
  document.removeEventListener("pointerup", d.onUp);
  document.removeEventListener("pointercancel", d.onUp);
  if (d.scrollParent) d.scrollParent.style.overflow = "";
  if (d.el?.releasePointerCapture && d.pointerId != null) {
    try {
      d.el.releasePointerCapture(d.pointerId);
    } catch {
      /* ignore */
    }
  }
  $("m-audio-drag-ghost").classList.add("hidden");
  document.body.classList.remove("m-audio-dragging");
  d.el.classList.remove("dragging");
  document.querySelectorAll(".drag-over").forEach((n) => n.classList.remove("drag-over"));
  state.drag = null;
}

function setupDraggable(el, key, label = "") {
  el.draggable = true;
  el.dataset.deviceKey = key;

  el.addEventListener("dragstart", (e) => {
    state.drag = { key, html: true };
    e.dataTransfer.setData("text/plain", key);
    e.dataTransfer.effectAllowed = "move";
    el.classList.add("dragging");
    document.body.classList.add("m-audio-dragging");
    const scrollParent = $("m-audio-devices");
    if (scrollParent) scrollParent.style.overflow = "hidden";
  });
  el.addEventListener("dragend", () => {
    el.classList.remove("dragging");
    document.body.classList.remove("m-audio-dragging");
    const scrollParent = $("m-audio-devices");
    if (scrollParent) scrollParent.style.overflow = "";
    if (state.drag?.html) state.drag = null;
  });

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || state.drag) return;
    e.stopPropagation();
    const scrollParent = $("m-audio-devices");
    let holdTimer;

    const cancelHold = () => clearTimeout(holdTimer);

    holdTimer = setTimeout(() => {
      el.removeEventListener("pointerup", cancelHold);
      el.removeEventListener("pointercancel", cancelHold);
      if (state.drag?.html) return;

      const ghost = $("m-audio-drag-ghost");
      ghost.textContent = label || key;
      ghost.classList.remove("hidden");
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
      el.classList.add("dragging");
      document.body.classList.add("m-audio-dragging");
      if (scrollParent) scrollParent.style.overflow = "hidden";
      if (el.setPointerCapture) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }

      const onMove = (ev) => {
        ev.preventDefault();
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
        document.querySelectorAll(".drag-over").forEach((n) => n.classList.remove("drag-over"));
        const target = dropTargetAt(ev.clientX, ev.clientY);
        if (target) target.classList.add("drag-over");
      };

      const onUp = async (ev) => {
        const target = dropTargetAt(ev.clientX, ev.clientY);
        endPointerDrag();
        if (!target) return;
        target.classList.remove("drag-over");
        try {
          await onDropForZone(target, key);
        } catch (err) {
          showError(err.message);
        }
      };

      state.drag = { key, el, holdTimer, pointerId: e.pointerId, scrollParent, onMove, onUp };
      document.addEventListener("pointermove", onMove, { passive: false });
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    }, DRAG_HOLD_MS);

    el.addEventListener("pointerup", cancelHold, { once: true });
    el.addEventListener("pointercancel", cancelHold, { once: true });
  });
}

async function onDropForZone(zone, key) {
  const coordId = zone.dataset.coordinatorId;
  const [, deviceId] = parseKey(key);

  if (zone.dataset.dropAction === "unjoin" || zone.id === "m-audio-others") {
    await leaveGroup(deviceId);
    return;
  }

  if (coordId && deviceId !== coordId) {
    const members = clusterMembers(state.devices, coordId);
    if (members.some((m) => m.device_id === deviceId)) return;
    await runAction(() => sonosAction(deviceId, "join", { coordinator_uid: coordId }));
  }
}

$("m-audio-refresh").innerHTML = ICONS.refresh;
$("m-audio-refresh").addEventListener("click", () => poll(true));

window.addEventListener("resize", () => syncMembersPlacement());

document.body.classList.add("m-audio-loading");
poll(true);
setInterval(() => poll(), POLL_MS);
setInterval(tickPlayback, TICK_MS);
