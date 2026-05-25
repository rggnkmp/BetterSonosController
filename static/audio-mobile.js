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
  scrubbing: false,
  pollInFlight: false,
  playbackClock: null,
  drag: null,
  coverKey: "",
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
  return `${d.source}:${d.device_id}`;
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

function nowPlaying() {
  return state.panel?.now_playing || null;
}

function activeCoordId() {
  const np = nowPlaying();
  if (!np) return null;
  return np.coordinator_id || np.id || null;
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

function patchNowPlaying(patch) {
  if (state.panel?.now_playing) Object.assign(state.panel.now_playing, patch);
}

function setMuteButton(btn, muted) {
  btn.innerHTML = muted ? ICONS.mute : ICONS.unmute;
  btn.setAttribute("aria-label", muted ? "Stumm aus" : "Stumm");
}

function setPlayButton(playing) {
  $("m-audio-toggle").innerHTML = playing ? ICONS.pause : ICONS.play;
  $("m-audio-toggle").setAttribute("aria-label", playing ? "Pause" : "Wiedergabe");
  patchNowPlaying({ playing, paused: !playing });
  if (!playing) state.playbackClock = null;
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

function syncClock(np) {
  if (!np?.playing || np.position_s == null || np.duration_s == null || np.duration_s <= 0) {
    state.playbackClock = null;
    return;
  }
  state.playbackClock = { position: np.position_s, duration: np.duration_s, syncedAt: Date.now() };
}

function currentPosition() {
  const np = nowPlaying();
  if (state.scrubbing) return Number($("m-audio-scrub").value);
  if (state.playbackClock && np?.playing) {
    const elapsed = (Date.now() - state.playbackClock.syncedAt) / 1000;
    return Math.min(state.playbackClock.position + elapsed, state.playbackClock.duration);
  }
  return np?.position_s ?? 0;
}

function tickPlayback() {
  if (state.scrubbing) return;
  const np = nowPlaying();
  if (!np?.playing) return;
  const pos = currentPosition();
  $("m-audio-scrub").value = String(Math.floor(pos));
  $("m-audio-pos").textContent = fmtTime(pos);
}

function setCover(np) {
  const cover = $("m-audio-cover");
  const ph = $("m-audio-cover-ph");
  const id = np?.coordinator_id || np?.id;
  const directUrl = (np?.cover_url || "").trim();
  const hasCover = Boolean(np?.has_cover && (directUrl || id));

  if (!hasCover) {
    state.coverKey = "";
    cover.classList.remove("is-loaded");
    cover.removeAttribute("src");
    ph.classList.remove("hidden");
    return;
  }

  const key = `${id}:${directUrl}`;
  if (key === state.coverKey && cover.classList.contains("is-loaded")) return;

  state.coverKey = key;
  cover.classList.remove("is-loaded");
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
  cover.src = id
    ? `/api/panel/audio/cover?device_id=${encodeURIComponent(id)}`
    : directUrl;

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
  vol.addEventListener("input", () => {
    patchDevice(member.device_id, { volume: Number(vol.value) });
  });
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
  const mute = iconBtn(
    muted ? ICONS.mute : ICONS.unmute,
    muted ? "Stumm aus" : "Stumm",
    () => {
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
    }
  );
  li.appendChild(mute);

  const actions = document.createElement("div");
  actions.className = "m-audio-member-actions";

  if (member.device_id !== coordinator.device_id) {
    actions.appendChild(
      iconBtn(ICONS.star, "Koordinator machen", () =>
        runAction(() =>
          sonosAction(coordinator.device_id, "promote_coordinator", {
            coordinator_uid: member.device_id,
          })
        )
      )
    );
    actions.appendChild(
      iconBtn(ICONS.leave, "Gruppe verlassen", () =>
        runAction(() => sonosAction(member.device_id, "unjoin")),
        { danger: true }
      )
    );
  }
  li.appendChild(actions);

  const takeover = iconBtn(ICONS.takeover, "Gruppe entlassen", () =>
    runAction(() => sonosAction(member.device_id, "takeover_group")),
    { danger: true, className: "m-audio-icon-btn m-audio-takeover-btn" }
  );
  li.appendChild(takeover);
  return li;
}

function otherRow(device) {
  const row = document.createElement("div");
  row.className = "m-audio-other-row";
  row.appendChild(createDragHandle(deviceKey(device), device.name));
  const name = document.createElement("span");
  name.className = "m-audio-other-name";
  name.textContent = device.name;
  row.appendChild(name);
  return row;
}

function renderActive(np, devices) {
  const coordId = activeCoordId();
  const active = Boolean(np && (np.playing || np.paused) && coordId);
  const members = active ? clusterMembers(devices, coordId) : [];
  const coordinator = members.find((m) => groupInfo(m).is_coordinator) || members[0];
  const isGroup = members.length > 1;

  $("m-audio-empty").classList.toggle("hidden", active || devices.length === 0);
  $("m-audio-active").classList.toggle("hidden", !active);

  if (!active) return;

  $("m-audio-device").textContent = isGroup
    ? `Gruppe · ${members.length} Lautsprecher`
    : np.name || "Sonos";
  $("m-audio-title").textContent = np.track_title || np.title || "Unbekannt";
  $("m-audio-artist").textContent = np.artist || "";
  $("m-audio-artist").classList.toggle("hidden", !np.artist);
  setCover(np);

  const dur = np.duration_s ?? 0;
  $("m-audio-scrub").max = String(Math.max(0, Math.floor(dur)));
  $("m-audio-scrub").value = String(Math.floor(currentPosition()));
  $("m-audio-pos").textContent = fmtTime(currentPosition());
  $("m-audio-dur").textContent = fmtTime(dur);

  $("m-audio-toggle").innerHTML = np.playing ? ICONS.pause : ICONS.play;
  $("m-audio-toggle").setAttribute("aria-label", np.playing ? "Pause" : "Wiedergabe");

  $("m-audio-solo-vol").classList.toggle("hidden", isGroup);
  if (!isGroup) {
    $("m-audio-vol").value = String(np.volume ?? 0);
    $("m-audio-vol-label").textContent = `${np.volume ?? 0}%`;
    $("m-audio-mute").innerHTML = np.muted ? ICONS.mute : ICONS.unmute;
    $("m-audio-mute").setAttribute("aria-label", np.muted ? "Stumm aus" : "Stumm");
  }

  const membersEl = $("m-audio-active-members");
  membersEl.innerHTML = "";
  membersEl.classList.toggle("hidden", !isGroup);

  if (isGroup && coordinator) {
    for (const m of sortMembers(members, coordinator)) {
      membersEl.appendChild(activeMemberRow(m, coordinator));
    }
  }

  setupDropZone($("m-audio-active"), async (key) => {
    const [, deviceId] = parseKey(key);
    if (deviceId === coordId) return;
    await sonosAction(deviceId, "join", { coordinator_uid: coordId });
  });

  syncClock(np);
}

function renderOthers(devices) {
  const coordId = activeCoordId();
  const np = nowPlaying();
  const active = Boolean(np && (np.playing || np.paused) && coordId);

  const others = devices
    .filter((d) => !active || clusterCoordId(d) !== coordId)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "de"));

  const othersEl = $("m-audio-others");
  othersEl.innerHTML = "";
  othersEl.classList.toggle("hidden", others.length === 0);
  $("m-audio-divider").classList.toggle("hidden", !active || others.length === 0);

  for (const d of others) othersEl.appendChild(otherRow(d));

  if (!state.dropBound) {
    setupDropZone(othersEl, async (key) => {
      const [, deviceId] = parseKey(key);
      await sonosAction(deviceId, "unjoin");
    });
    state.dropBound = true;
  }
}

function render(panel, devices) {
  state.panel = panel;
  state.devices = devices;
  document.body.classList.remove("m-audio-loading");

  $("m-audio-meta").textContent = panel.summary || `${devices.length} Lautsprecher`;

  const errors = [...(panel.errors || []), ...(devices.sonos_errors || [])].filter(Boolean);
  showError(errors.length ? errors.join(" · ") : null);

  renderActive(panel.now_playing, devices);
  renderOthers(devices);
}

async function poll(force = false) {
  if (state.pollInFlight && !force) return;
  state.pollInFlight = true;
  try {
    const [panelRes, devRes] = await Promise.all([
      fetch("/api/panel/audio"),
      fetch("/api/sonos/devices"),
    ]);
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
  return el?.closest("[data-drop-bound='1']");
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
      await poll(true);
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
  });
  el.addEventListener("dragend", () => {
    el.classList.remove("dragging");
    if (state.drag?.html) state.drag = null;
  });

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || state.drag) return;
    e.stopPropagation();
    const holdTimer = setTimeout(() => {
      if (state.drag?.html) return;
      const ghost = $("m-audio-drag-ghost");
      ghost.textContent = label || key;
      ghost.classList.remove("hidden");
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
      el.classList.add("dragging");
      document.body.classList.add("m-audio-dragging");

      const onMove = (ev) => {
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
          await poll(true);
        } catch (err) {
          showError(err.message);
        }
      };

      state.drag = { key, el, holdTimer, onMove, onUp };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    }, DRAG_HOLD_MS);

    const cancel = () => clearTimeout(holdTimer);
    el.addEventListener("pointerup", cancel, { once: true });
    el.addEventListener("pointercancel", cancel, { once: true });
  });
}

async function onDropForZone(zone, key) {
  const action = zone.dataset.dropAction;
  const coordId = zone.dataset.coordinatorId || activeCoordId();
  const [, deviceId] = parseKey(key);

  if (action === "unjoin" || zone.id === "m-audio-others") {
    await sonosAction(deviceId, "unjoin");
    return;
  }
  if (zone.id === "m-audio-active" && coordId && deviceId !== coordId) {
    await sonosAction(deviceId, "join", { coordinator_uid: coordId });
  }
}

function bindControls() {
  const np = () => nowPlaying();

  $("m-audio-prev").innerHTML = ICONS.prev;
  $("m-audio-next").innerHTML = ICONS.next;
  $("m-audio-refresh").innerHTML = ICONS.refresh;

  $("m-audio-refresh").addEventListener("click", () => poll(true));
  $("m-audio-toggle").addEventListener("click", () => {
    const n = np();
    if (!n?.id) return;
    const wasPlaying = Boolean(n.playing);
    const next = !wasPlaying;
    setPlayButton(next);
    runAction(() => sonosAction(n.id, "toggle"), {
      onError: () => setPlayButton(wasPlaying),
    });
  });
  $("m-audio-prev").addEventListener("click", () => {
    const id = np()?.id;
    if (id) runAction(() => sonosAction(id, "previous"));
  });
  $("m-audio-next").addEventListener("click", () => {
    const id = np()?.id;
    if (id) runAction(() => sonosAction(id, "next"));
  });
  $("m-audio-mute").addEventListener("click", () => {
    const n = np();
    if (!n?.id) return;
    const wasMuted = Boolean(n.muted);
    const next = !wasMuted;
    setMuteButton($("m-audio-mute"), next);
    patchNowPlaying({ muted: next });
    runAction(() => sonosAction(n.id, "set", { mute: next }), {
      onError: () => {
        setMuteButton($("m-audio-mute"), wasMuted);
        patchNowPlaying({ muted: wasMuted });
      },
    });
  });
  const vol = $("m-audio-vol");
  vol.addEventListener("input", () => {
    $("m-audio-vol-label").textContent = `${vol.value}%`;
    patchNowPlaying({ volume: Number(vol.value) });
  });
  vol.addEventListener("change", () => {
    const id = np()?.id;
    if (!id) return;
    const value = Number(vol.value);
    const prev = np()?.volume ?? 0;
    patchNowPlaying({ volume: value });
    runAction(() => sonosAction(id, "set", { volume: value }), {
      onError: () => {
        vol.value = String(prev);
        $("m-audio-vol-label").textContent = `${prev}%`;
        patchNowPlaying({ volume: prev });
      },
    });
  });
  const scrub = $("m-audio-scrub");
  scrub.addEventListener("pointerdown", () => {
    state.scrubbing = true;
  });
  scrub.addEventListener("input", () => {
    const pos = Number(scrub.value);
    $("m-audio-pos").textContent = fmtTime(pos);
    patchNowPlaying({ position_s: pos });
  });
  scrub.addEventListener("pointerup", () => {
    state.scrubbing = false;
    const id = np()?.id;
    if (!id) return;
    const pos = Number(scrub.value);
    const prev = np()?.position_s ?? 0;
    patchNowPlaying({ position_s: pos });
    syncClock(nowPlaying());
    runAction(() => sonosAction(id, "seek", { position: pos }), {
      onError: () => {
        scrub.value = String(Math.floor(prev));
        $("m-audio-pos").textContent = fmtTime(prev);
        patchNowPlaying({ position_s: prev });
        syncClock(nowPlaying());
      },
    });
  });
}

document.body.classList.add("m-audio-loading");
bindControls();
poll(true);
setInterval(() => poll(), POLL_MS);
setInterval(tickPlayback, TICK_MS);
