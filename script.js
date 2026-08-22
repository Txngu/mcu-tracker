/* ==========================================================================
   CHRONOVAULT — SCRIPT.JS
   All application logic: state, persistence, rendering, filtering, sorting,
   modal, stats/canvas charts, achievements, settings, timeline, confetti.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------ STATE -- */
  // Guest progress and each signed-in account's progress are kept in
  // separate localStorage slots so signing out always restores whatever
  // guest-mode data existed before you signed in — it's never overwritten
  // by a logged-in account's data.
  const GUEST_STORAGE_KEY = "chronovault:guest:v1";
  function userStorageKey(uid) {
    return `chronovault:user:${uid}`;
  }

  let state = {
    entries: [],                 // working copy of MCU_DATA (mutable)
    activeStorageKey: GUEST_STORAGE_KEY, // which localStorage slot is currently live
    view: "home",
    search: "",
    typeFilter: "all",
    phaseFilter: "all",
    sagaFilter: "all",
    sort: "chronological",
    displayMode: "grid",
    unwatchedOnly: false,
    theme: "dark",
    favorites: {},                // id -> bool
    watched: {},                  // id -> bool
    unlockedAchievements: {},      // id -> bool
    modalList: [],                // ids currently shown in modal context, for prev/next
    modalIndex: -1
  };

  /* ---------------------------------------------------------- PERSIST -- */
  function readStorageSlot(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn("Could not read storage slot:", key, e);
      return null;
    }
  }

  // Loads whichever slot is currently active (state.activeStorageKey) into
  // top-level state fields. Used once at startup, before we know auth status.
  function loadState() {
    const saved = readStorageSlot(state.activeStorageKey);
    if (saved) Object.assign(state, saved, { entries: [], activeStorageKey: state.activeStorageKey });
  }

  function saveState() {
    try {
      const toSave = {
        search: state.search,
        typeFilter: state.typeFilter,
        phaseFilter: state.phaseFilter,
        sagaFilter: state.sagaFilter,
        sort: state.sort,
        displayMode: state.displayMode,
        unwatchedOnly: state.unwatchedOnly,
        theme: state.theme,
        favorites: state.favorites,
        watched: state.watched,
        unlockedAchievements: state.unlockedAchievements
      };
      localStorage.setItem(state.activeStorageKey, JSON.stringify(toSave));
      if (window.CV_AUTH && window.CV_AUTH.isCloudEnabled() && window.CV_AUTH.getUser()) {
        window.CV_AUTH.saveCloudData(toSave);
      }
    } catch (e) {
      console.warn("Could not save state:", e);
    }
  }

  function buildWorkingEntries() {
    state.entries = MCU_DATA.map((base) => ({
      ...base,
      watched: !!state.watched[base.id],
      favorite: !!state.favorites[base.id]
    }));
  }

  /* ------------------------------------------------------------ POSTER -- */
  // Procedurally generated poster art (SVG data) — no external image hosts,
  // works fully offline, never breaks, and carries no copyright risk.
  const PHASE_COLORS = {
    "Phase 1": ["#3a7bd5", "#1a2b4a"],
    "Phase 2": ["#2ecc71", "#123a24"],
    "Phase 3": ["#ed1d24", "#3a0a0c"],
    "Phase 4": ["#8e44ec", "#2a1042"],
    "Phase 5": ["#f2622e", "#3a1806"],
    "Phase 6": ["#f2b134", "#3a2a06"]
  };

  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  function initials(title) {
    return title
      .replace(/[^A-Za-z0-9 ]/g, "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("");
  }

  function generatePosterSVG(entry) {
    const [c1, c2] = PHASE_COLORS[entry.phase] || ["#ed1d24", "#1a0508"];
    const seed = hashString(entry.id);
    const angle = 20 + (seed % 60);
    const gid = "g" + seed;
    const label = initials(entry.title) || "MCU";
    const typeLabel = entry.type.toUpperCase();
    return `
      <svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(entry.title)} poster">
        <defs>
          <linearGradient id="${gid}" x1="0%" y1="0%" x2="100%" y2="100%" gradientTransform="rotate(${angle} 0.5 0.5)">
            <stop offset="0%" stop-color="${c1}" />
            <stop offset="100%" stop-color="${c2}" />
          </linearGradient>
        </defs>
        <rect width="200" height="300" fill="${c2}"/>
        <rect width="200" height="300" fill="url(#${gid})" opacity="0.9"/>
        <g opacity="0.10">
          ${Array.from({ length: 6 }).map((_, i) =>
            `<circle cx="${(seed * (i + 3)) % 200}" cy="${(seed * (i + 7)) % 300}" r="${18 + (i * 6)}" fill="#ffffff"/>`
          ).join("")}
        </g>
        <rect x="0" y="230" width="200" height="70" fill="#000000" opacity="0.35"/>
        <text x="100" y="130" font-family="Bebas Neue, sans-serif" font-size="46" fill="#ffffff" text-anchor="middle" opacity="0.92">${escapeXml(label)}</text>
        <text x="100" y="255" font-family="Inter, sans-serif" font-size="11" font-weight="700" letter-spacing="1" fill="#ffffff" text-anchor="middle">${escapeXml(typeLabel)}</text>
        <text x="100" y="272" font-family="Inter, sans-serif" font-size="9" fill="#ffffffcc" text-anchor="middle">${escapeXml(entry.phase)}</text>
      </svg>
    `;
  }

  function escapeXml(str) {
    return String(str).replace(/[<>&'"]/g, (c) => ({
      "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;"
    }[c]));
  }

  /* ------------------------------------------------------------ HELPERS -- */
  function formatRuntime(mins) {
    if (mins == null) return "TBA";
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  function getPhases() {
    return [...new Set(MCU_DATA.map((e) => e.phase))];
  }
  function getSagas() {
    return [...new Set(MCU_DATA.map((e) => e.saga))];
  }

  function byId(id) {
    return state.entries.find((e) => e.id === id);
  }

  /* -------------------------------------------------------- FILTER/SORT -- */
  function getFilteredSorted() {
    let list = state.entries.slice();

    if (state.typeFilter !== "all") {
      list = list.filter((e) => e.type === state.typeFilter);
    }
    if (state.phaseFilter !== "all") {
      list = list.filter((e) => e.phase === state.phaseFilter);
    }
    if (state.sagaFilter !== "all") {
      list = list.filter((e) => e.saga === state.sagaFilter);
    }
    if (state.unwatchedOnly) {
      list = list.filter((e) => !e.watched);
    }
    if (state.search.trim()) {
      const q = state.search.trim().toLowerCase();
      list = list.filter((e) =>
        e.title.toLowerCase().includes(q) ||
        e.phase.toLowerCase().includes(q) ||
        e.saga.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q)
      );
    }

    switch (state.sort) {
      case "chronological":
        list.sort((a, b) => a.chronOrder - b.chronOrder);
        break;
      case "release":
        list.sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));
        break;
      case "alphabetical":
        list.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "runtime":
        list.sort((a, b) => (a.runtime || 0) - (b.runtime || 0));
        break;
    }
    return list;
  }

  /* ---------------------------------------------------------- RENDERING -- */
  const el = (sel) => document.querySelector(sel);
  const els = (sel) => Array.from(document.querySelectorAll(sel));

  function renderCardGrid() {
    const grid = el("#cardGrid");
    const empty = el("#emptyState");
    const list = getFilteredSorted();

    el("#resultsMeta").textContent = `${list.length} of ${state.entries.length} entries`;

    grid.classList.toggle("list-mode", state.displayMode === "list");

    if (!list.length) {
      grid.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    grid.innerHTML = list.map(cardTemplate).join("");

    // wire up interactions
    els(".card").forEach((cardEl) => {
      const id = cardEl.dataset.id;
      cardEl.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-action]")) return;
        openModal(id, list.map((e) => e.id));
      });
      const watchedBtn = cardEl.querySelector('[data-action="watched"]');
      const favBtn = cardEl.querySelector('[data-action="fav"]');
      watchedBtn.addEventListener("click", () => toggleWatched(id));
      favBtn.addEventListener("click", () => toggleFavorite(id));
    });
  }

  function cardTemplate(entry) {
    return `
      <article class="card" data-id="${entry.id}">
        <div class="card-poster">
          ${generatePosterSVG(entry)}
          ${entry.watched ? '<div class="card-watched-badge">✓</div>' : ""}
          ${entry.favorite ? '<div class="card-fav-badge">★</div>' : ""}
          <div class="card-type-tag">${escapeXml(entry.type)}</div>
        </div>
        <div class="card-body">
          <h3 class="card-title">${escapeXml(entry.title)}</h3>
          <div class="card-meta">${escapeXml(entry.phase)} · ${formatRuntime(entry.runtime)}</div>
          <div class="card-actions">
            <button class="btn ${entry.watched ? "is-watched" : ""}" data-action="watched">${entry.watched ? "Watched ✓" : "Mark Watched"}</button>
            <button class="btn fav-btn ${entry.favorite ? "is-fav" : ""}" data-action="fav">${entry.favorite ? "★" : "☆"}</button>
          </div>
        </div>
      </article>
    `;
  }

  function toggleWatched(id) {
    const wasComplete = isFullyComplete();
    state.watched[id] = !state.watched[id];
    if (!state.watched[id]) delete state.watched[id];
    buildWorkingEntries();
    saveState();
    renderAll();
    checkAchievements();
    if (!wasComplete && isFullyComplete()) fireConfetti();
  }

  function toggleFavorite(id) {
    state.favorites[id] = !state.favorites[id];
    if (!state.favorites[id]) delete state.favorites[id];
    buildWorkingEntries();
    saveState();
    renderAll();
  }

  function isFullyComplete() {
    return state.entries.filter((e) => e.type !== "Upcoming").every((e) => e.watched);
  }

  /* ------------------------------------------------------------ DASHBOARD */
  const STONE_COLORS = ["#3a7bd5", "#f2b134", "#ed1d24", "#8e44ec", "#2ecc71", "#f2622e"];

  function renderDashboard() {
    const trackable = state.entries.filter((e) => e.type !== "Upcoming");
    const watchedCount = trackable.filter((e) => e.watched).length;
    const total = trackable.length;
    const pct = total ? Math.round((watchedCount / total) * 100) : 0;

    const hoursWatched = trackable.filter((e) => e.watched).reduce((sum, e) => sum + (e.runtime || 0), 0) / 60;
    const hoursRemaining = trackable.filter((e) => !e.watched).reduce((sum, e) => sum + (e.runtime || 0), 0) / 60;

    el("#progressPercent").textContent = `${pct}%`;
    el("#statWatched").textContent = watchedCount;
    el("#statRemaining").textContent = total - watchedCount;
    el("#statHoursWatched").textContent = `${hoursWatched.toFixed(1)}h`;
    el("#statHoursRemaining").textContent = `${hoursRemaining.toFixed(1)}h`;

    renderStoneRing(pct);

    // next up: earliest chronOrder unwatched, non-upcoming
    const next = trackable
      .filter((e) => !e.watched)
      .sort((a, b) => a.chronOrder - b.chronOrder)[0];

    const nextCard = el("#nextUpCard");
    if (next) {
      nextCard.textContent = next.title;
      nextCard.onclick = () => openModal(next.id, [next.id]);
      nextCard.style.cursor = "pointer";
    } else {
      nextCard.textContent = "All caught up! 🎉";
      nextCard.onclick = null;
      nextCard.style.cursor = "default";
    }
  }

  function renderStoneRing(pct) {
    const g = el("#stoneSegments");
    const r = 60;
    const circumference = 2 * Math.PI * r;
    const segLen = circumference / 6;
    const gap = 3;
    g.innerHTML = "";
    const filledLen = (pct / 100) * circumference;
    let acc = 0;
    for (let i = 0; i < 6; i++) {
      const start = acc;
      const segFilled = Math.max(0, Math.min(segLen - gap, filledLen - start));
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", "70");
      circle.setAttribute("cy", "70");
      circle.setAttribute("r", r);
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", STONE_COLORS[i]);
      circle.setAttribute("stroke-width", "10");
      circle.setAttribute("stroke-linecap", "round");
      circle.setAttribute("stroke-dasharray", `${segFilled} ${circumference}`);
      circle.setAttribute("stroke-dashoffset", `${-start}`);
      circle.style.transition = "stroke-dasharray 500ms ease";
      g.appendChild(circle);
      acc += segLen;
    }
  }

  /* --------------------------------------------------------------- MODAL */
  function openModal(id, contextIds) {
    state.modalList = contextIds && contextIds.length ? contextIds : state.entries.map((e) => e.id);
    state.modalIndex = state.modalList.indexOf(id);
    renderModal();
    el("#modalOverlay").classList.add("open");
  }

  function closeModal() {
    el("#modalOverlay").classList.remove("open");
  }

  function renderModal() {
    const id = state.modalList[state.modalIndex];
    const entry = byId(id);
    if (!entry) return;

    el("#modalPoster").innerHTML = generatePosterSVG(entry);
    el("#modalType").textContent = entry.type;
    el("#modalTitle").textContent = entry.title;
    el("#modalPhase").textContent = entry.phase;
    el("#modalSaga").textContent = entry.saga;
    el("#modalRuntime").textContent = formatRuntime(entry.runtime);
    el("#modalDate").textContent = `Release date: ${formatDate(entry.releaseDate)}`;
    el("#modalDesc").textContent = entry.description;

    const wBtn = el("#modalWatchedBtn");
    wBtn.textContent = entry.watched ? "Watched ✓" : "Mark Watched";
    wBtn.classList.toggle("btn-primary", !entry.watched);
    wBtn.onclick = () => { toggleWatched(entry.id); renderModal(); };

    const fBtn = el("#modalFavBtn");
    fBtn.textContent = entry.favorite ? "★ Favorited" : "☆ Favorite";
    fBtn.onclick = () => { toggleFavorite(entry.id); renderModal(); };

    // prev/next within full chronological order (not just modal context)
    const chronoSorted = state.entries.slice().sort((a, b) => a.chronOrder - b.chronOrder);
    const chronoIdx = chronoSorted.findIndex((e) => e.id === entry.id);
    const prevEntry = chronoSorted[chronoIdx - 1];
    const nextEntry = chronoSorted[chronoIdx + 1];

    const prevBtn = el("#modalPrev");
    const nextBtn = el("#modalNext");
    prevBtn.disabled = !prevEntry;
    nextBtn.disabled = !nextEntry;
    prevBtn.style.opacity = prevEntry ? 1 : 0.4;
    nextBtn.style.opacity = nextEntry ? 1 : 0.4;
    prevBtn.onclick = () => prevEntry && openModal(prevEntry.id, state.modalList);
    nextBtn.onclick = () => nextEntry && openModal(nextEntry.id, state.modalList);
  }

  /* ------------------------------------------------------------ TIMELINE */
  function renderTimeline() {
    const track = el("#timelineTrack");
    const sorted = state.entries.slice().sort((a, b) => a.chronOrder - b.chronOrder);
    track.innerHTML = sorted.map((e) => `
      <div class="timeline-item ${e.watched ? "watched" : ""}">
        <div class="timeline-card" data-id="${e.id}">
          <div class="timeline-thumb">${generatePosterSVG(e)}</div>
          <div>
            <div class="timeline-title">${escapeXml(e.title)}</div>
            <div class="timeline-meta">${escapeXml(e.phase)} · ${escapeXml(e.saga)} · ${formatDate(e.releaseDate)}</div>
          </div>
        </div>
      </div>
    `).join("");
    els(".timeline-card").forEach((c) => {
      c.addEventListener("click", () => openModal(c.dataset.id, sorted.map((e) => e.id)));
    });
  }

  /* --------------------------------------------------------------- STATS */
  function renderStats() {
    const trackable = state.entries.filter((e) => e.type !== "Upcoming");
    const watchedTrackable = trackable.filter((e) => e.watched);

    el("#s-total").textContent = state.entries.length;
    el("#s-movies").textContent = watchedTrackable.filter((e) => e.type === "Movie").length;
    el("#s-series").textContent = watchedTrackable.filter((e) => e.type.includes("Series")).length;

    const hoursWatched = watchedTrackable.reduce((s, e) => s + (e.runtime || 0), 0) / 60;
    const hoursRemaining = trackable.filter((e) => !e.watched).reduce((s, e) => s + (e.runtime || 0), 0) / 60;
    el("#s-hours-watched").textContent = hoursWatched.toFixed(1);
    el("#s-hours-remaining").textContent = hoursRemaining.toFixed(1);

    const pct = trackable.length ? Math.round((watchedTrackable.length / trackable.length) * 100) : 0;
    el("#s-completion").textContent = `${pct}%`;
    el("#s-favorites").textContent = state.entries.filter((e) => e.favorite).length;

    drawPieChart("#phaseChart", "#phaseLegend", groupCount(state.entries, "phase"));
    drawPieChart("#sagaChart", "#sagaLegend", groupCount(state.entries, "saga"));
  }

  function groupCount(list, key) {
    const map = {};
    list.forEach((e) => { map[e[key]] = (map[e[key]] || 0) + 1; });
    return map;
  }

  const CHART_PALETTE = ["#ed1d24", "#3a7bd5", "#f2b134", "#8e44ec", "#2ecc71", "#f2622e", "#66666e"];

  function drawPieChart(canvasSel, legendSel, dataMap) {
    const canvas = el(canvasSel);
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const entries = Object.entries(dataMap);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    if (!total) return;

    const cx = w / 2, cy = h / 2, radius = Math.min(w, h) / 2 - 10;
    let startAngle = -Math.PI / 2;

    entries.forEach(([label, value], i) => {
      const sliceAngle = (value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
      ctx.closePath();
      ctx.fillStyle = CHART_PALETTE[i % CHART_PALETTE.length];
      ctx.fill();
      startAngle += sliceAngle;
    });

    // donut hole for a cleaner look
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    const legend = el(legendSel);
    legend.innerHTML = entries.map(([label, value], i) => `
      <span class="legend-item">
        <span class="legend-swatch" style="background:${CHART_PALETTE[i % CHART_PALETTE.length]}"></span>
        ${escapeXml(label)} (${value})
      </span>
    `).join("");
  }

  /* --------------------------------------------------------- ACHIEVEMENTS */
  const ACHIEVEMENTS = [
    { id: "first-watch", icon: "🎬", name: "First Watch", desc: "Mark your first project as watched.",
      test: () => state.entries.some((e) => e.watched) },
    { id: "phase1-done", icon: "🛡️", name: "Origin Story", desc: "Finish all of Phase 1.",
      test: () => phaseComplete("Phase 1") },
    { id: "phase2-done", icon: "🐜", name: "Age of Heroes", desc: "Finish all of Phase 2.",
      test: () => phaseComplete("Phase 2") },
    { id: "phase3-done", icon: "🧤", name: "Infinity's Reach", desc: "Finish all of Phase 3.",
      test: () => phaseComplete("Phase 3") },
    { id: "infinity-saga-done", icon: "💎", name: "Infinity Saga Complete", desc: "Finish every entry in the Infinity Saga.",
      test: () => sagaComplete("Infinity Saga") },
    { id: "multiverse-saga-done", icon: "🌀", name: "Multiverse Master", desc: "Finish every entry in the Multiverse Saga.",
      test: () => sagaComplete("Multiverse Saga") },
    { id: "pct-25", icon: "🥉", name: "Quarter Way There", desc: "Reach 25% completion.",
      test: () => completionPct() >= 25 },
    { id: "pct-50", icon: "🥈", name: "Halfway Point", desc: "Reach 50% completion.",
      test: () => completionPct() >= 50 },
    { id: "pct-75", icon: "🥇", name: "Almost Assembled", desc: "Reach 75% completion.",
      test: () => completionPct() >= 75 },
    { id: "pct-100", icon: "🏆", name: "Fully Assembled", desc: "Reach 100% completion.",
      test: () => completionPct() >= 100 },
    { id: "collector", icon: "⭐", name: "Collector", desc: "Favorite 5 different projects.",
      test: () => state.entries.filter((e) => e.favorite).length >= 5 }
  ];

  function phaseComplete(phase) {
    const list = state.entries.filter((e) => e.phase === phase && e.type !== "Upcoming");
    return list.length > 0 && list.every((e) => e.watched);
  }
  function sagaComplete(saga) {
    const list = state.entries.filter((e) => e.saga === saga && e.type !== "Upcoming");
    return list.length > 0 && list.every((e) => e.watched);
  }
  function completionPct() {
    const trackable = state.entries.filter((e) => e.type !== "Upcoming");
    if (!trackable.length) return 0;
    return (trackable.filter((e) => e.watched).length / trackable.length) * 100;
  }

  function checkAchievements() {
    ACHIEVEMENTS.forEach((a) => {
      if (!state.unlockedAchievements[a.id] && a.test()) {
        state.unlockedAchievements[a.id] = true;
        showAchievementToast(a);
      }
    });
    saveState();
    renderAchievements();
  }

  function renderAchievements() {
    const grid = el("#achievementsGrid");
    grid.innerHTML = ACHIEVEMENTS.map((a) => {
      const unlocked = !!state.unlockedAchievements[a.id];
      return `
        <div class="ach-card ${unlocked ? "unlocked" : ""}">
          <div class="ach-icon">${a.icon}</div>
          <div>
            <div class="ach-name">${escapeXml(a.name)}</div>
            <div class="ach-desc">${escapeXml(a.desc)}</div>
          </div>
        </div>
      `;
    }).join("");
  }

  function showAchievementToast(a) {
    const wrap = el("#achievementPopup");
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `
      <div class="toast-icon">${a.icon}</div>
      <div>
        <div class="toast-title">Achievement Unlocked</div>
        <div class="toast-name">${escapeXml(a.name)}</div>
      </div>
    `;
    wrap.appendChild(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  /* ---------------------------------------------------------------- CONFETTI */
  function fireConfetti() {
    const canvas = el("#confettiCanvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");
    const colors = ["#ed1d24", "#f2b134", "#3a7bd5", "#8e44ec", "#2ecc71", "#f2622e"];
    const pieces = Array.from({ length: 160 }).map(() => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.5,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 10,
      color: colors[Math.floor(Math.random() * colors.length)],
      speed: 2 + Math.random() * 4,
      drift: -2 + Math.random() * 4,
      rot: Math.random() * Math.PI,
      rotSpeed: -0.2 + Math.random() * 0.4
    }));
    let frame = 0;
    const maxFrames = 220;

    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach((p) => {
        p.y += p.speed;
        p.x += p.drift;
        p.rot += p.rotSpeed;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      frame++;
      if (frame < maxFrames) {
        requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------- VIEWS -- */
  function switchView(view) {
    state.view = view;
    els(".view").forEach((v) => v.classList.remove("active-view"));
    el(`#view-${view}`).classList.add("active-view");
    els(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));

    if (view === "stats") renderStats();
    if (view === "timeline") renderTimeline();
    if (view === "achievements") renderAchievements();
  }

  /* ------------------------------------------------------------- THEME -- */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.theme);
    els(".seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.theme === state.theme));
  }

  /* ----------------------------------------------------------- FILTERS UI */
  function populateFilterSelects() {
    const phaseSel = el("#phaseFilter");
    getPhases().forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p; opt.textContent = p;
      phaseSel.appendChild(opt);
    });
    const sagaSel = el("#sagaFilter");
    getSagas().forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s; opt.textContent = s;
      sagaSel.appendChild(opt);
    });
    phaseSel.value = state.phaseFilter;
    sagaSel.value = state.sagaFilter;
    el("#sortSelect").value = state.sort;
  }

  /* --------------------------------------------------------- MAIN RENDER */
  function renderAll() {
    renderDashboard();
    renderCardGrid();
    if (state.view === "stats") renderStats();
    if (state.view === "timeline") renderTimeline();
    if (state.view === "achievements") renderAchievements();
  }

  /* -------------------------------------------------------- EVENT WIRING */
  function wireEvents() {
    // nav
    els(".nav-btn").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
    el("#navHome").addEventListener("click", () => switchView("home"));

    // search
    const searchInput = el("#searchInput");
    searchInput.addEventListener("input", (e) => {
      state.search = e.target.value;
      renderCardGrid();
    });

    // type filter chips
    els("#typeFilters .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.typeFilter = chip.dataset.filterType;
        els("#typeFilters .chip").forEach((c) => c.classList.toggle("active", c === chip));
        saveState();
        renderCardGrid();
      });
    });

    // phase/saga/sort selects
    el("#phaseFilter").addEventListener("change", (e) => { state.phaseFilter = e.target.value; saveState(); renderCardGrid(); });
    el("#sagaFilter").addEventListener("change", (e) => { state.sagaFilter = e.target.value; saveState(); renderCardGrid(); });
    el("#sortSelect").addEventListener("change", (e) => { state.sort = e.target.value; saveState(); renderCardGrid(); });

    // unwatched only
    el("#watchedOnlyToggle").addEventListener("click", (e) => {
      state.unwatchedOnly = !state.unwatchedOnly;
      e.target.dataset.active = state.unwatchedOnly;
      saveState();
      renderCardGrid();
    });

    // grid/list toggle
    el("#gridViewBtn").addEventListener("click", () => setDisplayMode("grid"));
    el("#listViewBtn").addEventListener("click", () => setDisplayMode("list"));

    // clear filters
    el("#clearFiltersBtn").addEventListener("click", () => {
      state.search = ""; state.typeFilter = "all"; state.phaseFilter = "all"; state.sagaFilter = "all"; state.unwatchedOnly = false;
      searchInput.value = "";
      el("#phaseFilter").value = "all";
      el("#sagaFilter").value = "all";
      el("#watchedOnlyToggle").dataset.active = "false";
      els("#typeFilters .chip").forEach((c) => c.classList.toggle("active", c.dataset.filterType === "all"));
      saveState();
      renderCardGrid();
    });

    // random / tonight
    el("#randomBtn").addEventListener("click", () => {
      const pool = state.entries.filter((e) => e.type !== "Upcoming");
      const pick = pool[Math.floor(Math.random() * pool.length)];
      openModal(pick.id, pool.map((e) => e.id));
    });
    el("#tonightBtn").addEventListener("click", () => {
      const unwatched = state.entries.filter((e) => !e.watched && e.type !== "Upcoming");
      const pool = unwatched.length ? unwatched : state.entries.filter((e) => e.type !== "Upcoming");
      const pick = pool[Math.floor(Math.random() * pool.length)];
      openModal(pick.id, pool.map((e) => e.id));
    });

    // modal
    el("#modalClose").addEventListener("click", closeModal);
    el("#modalOverlay").addEventListener("click", (e) => { if (e.target.id === "modalOverlay") closeModal(); });

    // settings
    el("#settingsBtn").addEventListener("click", () => el("#settingsOverlay").classList.add("open"));
    el("#settingsClose").addEventListener("click", () => el("#settingsOverlay").classList.remove("open"));
    el("#settingsOverlay").addEventListener("click", (e) => { if (e.target.id === "settingsOverlay") el("#settingsOverlay").classList.remove("open"); });

    els(".seg-btn").forEach((b) => b.addEventListener("click", () => {
      state.theme = b.dataset.theme;
      applyTheme();
      saveState();
    }));

    el("#exportBtn").addEventListener("click", exportProgress);
    el("#importInput").addEventListener("change", importProgress);
    el("#resetBtn").addEventListener("click", resetProgress);

    // keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      const tag = document.activeElement.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "Escape") {
        closeModal();
        el("#settingsOverlay").classList.remove("open");
        return;
      }
      if (typing) return;

      if (e.key === "/") { e.preventDefault(); searchInput.focus(); }
      else if (e.key.toLowerCase() === "g") setDisplayMode("grid");
      else if (e.key.toLowerCase() === "l") setDisplayMode("list");
      else if (e.key.toLowerCase() === "r") el("#randomBtn").click();
    });
  }

  function setDisplayMode(mode) {
    state.displayMode = mode;
    el("#gridViewBtn").classList.toggle("active", mode === "grid");
    el("#listViewBtn").classList.toggle("active", mode === "list");
    saveState();
    renderCardGrid();
  }

  /* ---------------------------------------------------------- IMPORT/EXPORT */
  function exportProgress() {
    const data = {
      favorites: state.favorites,
      watched: state.watched,
      unlockedAchievements: state.unlockedAchievements,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "chronovault-progress.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importProgress(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        state.favorites = data.favorites || {};
        state.watched = data.watched || {};
        state.unlockedAchievements = data.unlockedAchievements || {};
        buildWorkingEntries();
        saveState();
        renderAll();
        renderAchievements();
        alert("Progress imported successfully.");
      } catch (err) {
        alert("That file couldn't be read as valid progress data.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function resetProgress() {
    if (!confirm("This will erase all watched/favorite/achievement progress. Continue?")) return;
    state.favorites = {};
    state.watched = {};
    state.unlockedAchievements = {};
    buildWorkingEntries();
    saveState();
    renderAll();
    renderAchievements();
    el("#settingsOverlay").classList.remove("open");
  }

  /* ------------------------------------------------------------- AUTH UI -- */
  function openAuthModal() {
    el("#authError").hidden = true;
    el("#authOverlay").classList.add("open");
  }
  function closeAuthModal() {
    el("#authOverlay").classList.remove("open");
  }

  function setAuthTab(tab) {
    els(".auth-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    el("#authSubmit").textContent = tab === "signup" ? "Create Account" : "Sign In";
    el("#authForm").dataset.mode = tab;
  }

  function showAuthError(message) {
    const errEl = el("#authError");
    errEl.textContent = message;
    errEl.hidden = false;
  }

  function updateAuthButton(user) {
    const label = el("#authBtnLabel");
    const btn = el("#authBtn");
    if (user) {
      label.textContent = user.email.split("@")[0];
      btn.classList.add("is-signed-in");
      btn.title = "Signed in — click to manage your account";
    } else {
      label.textContent = "Sign In";
      btn.classList.remove("is-signed-in");
      btn.title = "Sign in to sync across devices";
    }
  }

  function renderAuthModalState(user) {
    const cloudOk = window.CV_AUTH && window.CV_AUTH.isCloudEnabled();
    el("#authSignedOut").hidden = !!user;
    el("#authSignedIn").hidden = !user;
    if (user) {
      el("#authUserEmail").textContent = user.email;
    } else {
      el("#authCloudHint").textContent = cloudOk
        ? "Sign in to keep your watched list and favorites in sync across every device."
        : "Cloud sync isn't set up for this copy of the app yet — see SETUP.md. You can still use everything locally.";
      el("#authSubmit").disabled = !cloudOk;
    }
  }

  // Merge a cloud data snapshot into local state. Cloud is treated as the
  // source of truth once a user signs in on a device.
  function applyCloudSnapshot(cloudData) {
    if (!cloudData) return;
    state.favorites = cloudData.favorites || {};
    state.watched = cloudData.watched || {};
    state.unlockedAchievements = cloudData.unlockedAchievements || {};
    if (cloudData.theme) state.theme = cloudData.theme;
    if (cloudData.sort) state.sort = cloudData.sort;
    buildWorkingEntries();
    applyTheme();
    saveLocalOnly(); // cache cloud data locally too, without re-triggering a cloud write
    renderAll();
    renderAchievements();
  }

  // Save to localStorage only (used right after pulling fresh cloud data, so
  // we don't immediately echo it straight back to the cloud).
  function saveLocalOnly() {
    try {
      const toSave = {
        search: state.search, typeFilter: state.typeFilter, phaseFilter: state.phaseFilter,
        sagaFilter: state.sagaFilter, sort: state.sort, displayMode: state.displayMode,
        unwatchedOnly: state.unwatchedOnly, theme: state.theme, favorites: state.favorites,
        watched: state.watched, unlockedAchievements: state.unlockedAchievements
      };
      localStorage.setItem(state.activeStorageKey, JSON.stringify(toSave));
    } catch (e) { /* ignore */ }
  }

  // Switch back to guest-mode data (whatever was on this device before any
  // account was signed into) — used on sign-out so a logged-in account's
  // progress never leaks into or overwrites guest mode.
  function switchToGuestStorage() {
    state.activeStorageKey = GUEST_STORAGE_KEY;
    const saved = readStorageSlot(GUEST_STORAGE_KEY) || {};
    state.favorites = saved.favorites || {};
    state.watched = saved.watched || {};
    state.unlockedAchievements = saved.unlockedAchievements || {};
    if (saved.theme) state.theme = saved.theme;
    if (saved.sort) state.sort = saved.sort;
    buildWorkingEntries();
    applyTheme();
    renderAll();
    renderAchievements();
  }

  function handleAuthSuccess(user) {
    updateAuthButton(user);
    renderAuthModalState(user);

    if (!user) {
      if (window.CV_AUTH) window.CV_AUTH.unsubscribeUserDoc();
      switchToGuestStorage();
      closeAuthModal();
      return;
    }

    // Switch to this account's own storage slot *before* the first cloud
    // snapshot arrives, so nothing gets written into guest storage or
    // another account's slot in the meantime.
    state.activeStorageKey = userStorageKey(user.uid);

    let firstSnapshot = true;
    window.CV_AUTH.subscribeToUserDoc(user.uid, (cloudData) => {
      if (cloudData) {
        applyCloudSnapshot(cloudData);
      } else if (firstSnapshot) {
        // First time this account has ever signed in anywhere — treat
        // whatever was in guest mode on this device as its starting
        // progress and push it up.
        saveState();
      }
      firstSnapshot = false;
    });

    closeAuthModal();
  }

  function wireAuthEvents() {
    el("#authBtn").addEventListener("click", () => {
      const user = window.CV_AUTH && window.CV_AUTH.getUser();
      openAuthModal();
      renderAuthModalState(user);
    });
    el("#authClose").addEventListener("click", closeAuthModal);
    el("#authOverlay").addEventListener("click", (e) => { if (e.target.id === "authOverlay") closeAuthModal(); });

    els(".auth-tab").forEach((b) => b.addEventListener("click", () => setAuthTab(b.dataset.tab)));
    setAuthTab("signin");

    el("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = el("#authEmail").value.trim();
      const password = el("#authPassword").value;
      const mode = el("#authForm").dataset.mode || "signin";
      el("#authError").hidden = true;
      try {
        if (mode === "signup") {
          await window.CV_AUTH.signUp(email, password);
        } else {
          await window.CV_AUTH.signIn(email, password);
        }
        // handleAuthSuccess fires via the auth-state-changed listener below
      } catch (err) {
        showAuthError(err.message || "Something went wrong. Please try again.");
      }
    });

    el("#authForgot").addEventListener("click", async () => {
      const email = el("#authEmail").value.trim();
      if (!email) { showAuthError("Enter your email above first, then tap Forgot password."); return; }
      try {
        await window.CV_AUTH.resetPassword(email);
        showAuthError("Password reset email sent — check your inbox.");
        el("#authError").style.color = "var(--text-dim)";
      } catch (err) {
        showAuthError(err.message || "Couldn't send reset email.");
      }
    });

    el("#authSignOutBtn").addEventListener("click", async () => {
      await window.CV_AUTH.signOut();
      closeAuthModal();
    });

    document.addEventListener("cv-auth-changed", (e) => {
      handleAuthSuccess(e.detail.user);
    });
  }

  /* ------------------------------------------------------------------ INIT */
  function init() {
    loadState();
    buildWorkingEntries();
    applyTheme();
    populateFilterSelects();

    // restore filter UI to saved state
    el("#searchInput").value = state.search || "";
    els("#typeFilters .chip").forEach((c) => c.classList.toggle("active", c.dataset.filterType === state.typeFilter));
    el("#watchedOnlyToggle").dataset.active = state.unwatchedOnly;
    el("#gridViewBtn").classList.toggle("active", state.displayMode !== "list");
    el("#listViewBtn").classList.toggle("active", state.displayMode === "list");

    wireEvents();
    wireAuthEvents();
    renderAll();
    renderAchievements();
    checkAchievements();

    // Pick up an already-signed-in session (e.g. returning visitor) once
    // Firebase reports its initial auth state.
    if (window.CV_AUTH) {
      window.CV_AUTH.onReady((user) => {
        updateAuthButton(user);
        if (user) handleAuthSuccess(user);
      });
    }

    // hide splash once everything is ready
    setTimeout(() => el("#splash").classList.add("hide"), 900);
  }

  document.addEventListener("DOMContentLoaded", init);

  // Register service worker for offline support (ignored gracefully if the
  // page is opened directly via file:// where service workers aren't allowed).
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }
})();