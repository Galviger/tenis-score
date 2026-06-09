const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const loginBtn = document.getElementById("login");
const logoutBtn = document.getElementById("logout");
const codeInput = document.getElementById("code");
const loginError = document.getElementById("loginError");
const meEl = document.getElementById("me");
const releaseDisplayBtn = document.getElementById("releaseDisplay");

let adminCourt = Number(localStorage.getItem("adminCourt") || "1");
if (![1,2,3].includes(adminCourt)) adminCourt = 1;

function setAdminCourt(n) {
  adminCourt = n;
  localStorage.setItem("adminCourt", String(n));
}

function clearAdminForm(id) {
  const set = (sel, val) => {
    const el = document.getElementById(sel);
    if (el) el.value = val;
  };

  set(`teamA-${id}`, "");
  set(`teamB-${id}`, "");
  set(`matchNote-${id}`, "");

  const mt = document.getElementById(`matchType-${id}`);
  if (mt) mt.value = "singles";   // default

  const st = document.getElementById(`status-${id}`);
  if (st) st.value = "playing";   // nebo "waiting", jak chceš
}

let pendingState = null;
let isSaving = false;

let adminDirtyUntil = 0;
function markAdminDirty(ms = 15000) {
  adminDirtyUntil = Date.now() + ms;
}
function isAdminDirty() {
  return Date.now() < adminDirtyUntil;
}

function isEditingInApp() {
  const a = document.activeElement;
  if (!a) return false;
  if (!a.closest("#appView")) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName);
}

function isEditingInApp() {
  const a = document.activeElement;
  if (!a) return false;
  if (!a.closest("#appView")) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName);
}
let courtDirtyUntil = 0;

function markCourtDirty(ms = 15000) { // klidně 30s
  courtDirtyUntil = Date.now() + ms;
}

function isCourtDirty() {
  return Date.now() < courtDirtyUntil;
}
// ---- ochrana proti live přerenderu během editace ----
let suspendRenderUntil = 0;

function suspendRender(ms = 1500) {
  suspendRenderUntil = Date.now() + ms;
}

function canRenderNow() {
  return Date.now() >= suspendRenderUntil;
}

// když uživatel píše nebo mění select, na chvíli stop render
document.addEventListener("input", (e) => {
  if (e.target.closest("#appView input, #appView textarea, #appView select")) {
    markCourtDirty();
  }
});
document.addEventListener("change", (e) => {
  if (e.target.closest("#appView input, #appView textarea, #appView select")) {
    markCourtDirty();
  }
});
document.addEventListener("focusin", (e) => {
  if (e.target.closest("#appView input, #appView textarea, #appView select")) {
    suspendRender(1500);
  }
});

document.addEventListener("input", (e) => {
  if (role === "admin" && e.target.closest("#appView input, #appView textarea, #appView select")) {
    markAdminDirty(15000);
  }
});
document.addEventListener("change", (e) => {
  if (role === "admin" && e.target.closest("#appView input, #appView textarea, #appView select")) {
    markAdminDirty(15000);
  }
});
document.addEventListener("focusin", (e) => {
  if (role === "admin" && e.target.closest("#appView input, #appView textarea, #appView select")) {
    markAdminDirty(15000);
  }
});

function getDeviceId() {
  let id = localStorage.getItem("deviceId");
  if (!id) {
    // jednoduché UUID bez knihoven
    id = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
    localStorage.setItem("deviceId", id);
  }
  return id;
}

let token = localStorage.getItem("token") || null;
let role = localStorage.getItem("role") || null;
let courtId = localStorage.getItem("courtId") ? Number(localStorage.getItem("courtId")) : null;

const socket = io();

socket.on("state", (payload) => {
  if (!token) return;

  // ADMIN i COURT: když edituju nebo ukládám, nerenderuj, jen si update zapamatuj
  if ((role === "admin" || role === "court") && (isSaving || isEditingInApp())) {
    pendingState = payload;
    return;
  }

  // COURT: navíc respektuj “dirty” (stepper)
  if (role === "court" && typeof isCourtDirty === "function" && isCourtDirty()) {
    pendingState = payload;
    return;
  }

  render(payload);
});
document.addEventListener("focusout", () => {
  if (role !== "admin" && role !== "court") return;
  if (isSaving) return;
  if (isEditingInApp()) return;

  if (pendingState) {
    const st = pendingState;
    pendingState = null;
    render(st);
  }
});

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function setSession(sess) {
  token = sess.token;
  role = sess.role;
  courtId = sess.courtId ?? null;

  localStorage.setItem("token", token);
  localStorage.setItem("role", role);
  if (courtId) localStorage.setItem("courtId", String(courtId));
  else localStorage.removeItem("courtId");
}

function clearSession() {
  token = null; role = null; courtId = null;
  localStorage.removeItem("token");
  localStorage.removeItem("role");
  localStorage.removeItem("courtId");
}

const adminTabsEl = document.getElementById("adminTabs");

function renderAdminTabs() {
  if (role !== "admin") {
    adminTabsEl.classList.add("hidden");
    adminTabsEl.innerHTML = "";
    return;
  }

  adminTabsEl.classList.remove("hidden");
  adminTabsEl.innerHTML = [1,2,3].map(n => `
    <button type="button" class="tabBtn ${adminCourt===n ? "active" : ""}" id="tabCourt-${n}">
      Kurt ${n}
    </button>
  `).join("");

  [1,2,3].forEach(n => {
    document.getElementById(`tabCourt-${n}`)?.addEventListener("click", async () => {
      setAdminCourt(n);

      // okamžitý refresh vybraného kurtu
      try {
        const st = await api("/api/state");
        render(st);
      } catch (e) {}
    });
  });
}


function setView(loggedIn) {
  loginView.classList.toggle("hidden", loggedIn);
  appView.classList.toggle("hidden", !loggedIn);

  const isAdmin = loggedIn && role === "admin";

  // 🔐 Odhlášení jen pro ADMIN
  logoutBtn.disabled = !isAdmin;
  logoutBtn.classList.toggle("hidden", !isAdmin);

  // 🔓 Release DISPLAY jen pro ADMIN
  releaseDisplayBtn.disabled = !isAdmin;
  releaseDisplayBtn.classList.toggle("hidden", !isAdmin);

  // Info o režimu
  meEl.textContent = loggedIn
    ? (role === "admin"
        ? "Režim: ADMIN"
        : role === "display"
          ? "Režim: DISPLAY"
          : `Režim: COURT (kurt ${courtId})`)
    : "";
  document.body.classList.toggle("display", loggedIn && role === "display");
  document.body.classList.toggle("admin",   loggedIn && role === "admin");
  document.body.classList.toggle("court",   loggedIn && role === "court");
  renderAdminTabs();
}

loginBtn.addEventListener("click", async () => {
  loginError.textContent = "";
  const code = String(codeInput.value || "").trim();
  if (!code) { loginError.textContent = "Vyber režim ze seznamu."; return; }

  let password = undefined;

  if (code === "A") {
    password = window.prompt("Zadej admin heslo:");
    if (password === null) return; // uživatel dal Cancel
    if (!password) { loginError.textContent = "Heslo nesmí být prázdné."; return; }
  }

  try {
    const resp = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        takeover: true,
        deviceId: getDeviceId(),
        password
      })
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || "Login failed");

    // ulož token/role/courtId jako doteď...
    token = data.token;
    role = data.role;
    courtId = data.courtId || null;
    localStorage.setItem("token", token);
    localStorage.setItem("role", role);
    localStorage.setItem("courtId", String(courtId || ""));

    setView(true);
    renderAdminTabs();
    const state = await api("/api/state");
    render(state);
  } catch (e) {
    loginError.textContent = e.message || "Login failed";
  }
});

logoutBtn.addEventListener("click", () => {
  // bezpečnost: odhlašování povol jen DISPLAY
  if (role !== "admin") return;

  clearSession();
  codeInput.value = "";
  setView(false);
  appView.innerHTML = "";
});
releaseDisplayBtn.addEventListener("click", async () => {
  if (role !== "admin") return;

  const ok = confirm("Uvolnit DISPLAY? (odpojí se aktuální zobrazovací zařízení a půjde přihlásit jinde)");
  if (!ok) return;

  try {
    await api("/api/unbind/display", { method: "POST" });
    alert("DISPLAY uvolněn. Nové zařízení se může přihlásit kódem D.");
  } catch (e) {
    alert(e.message);
  }
});
async function boot() {
  if (!token) {
    setView(false);
    return;
  }

  setView(true);

  try {
    const state = await api("/api/state");
    render(state);
  } catch (e) {
    clearSession();
    setView(false);
    appView.innerHTML = "";
    return;
  }

  // 🔁 heartbeat – hlídá, že server session pořád platí
  setInterval(async () => {
    if (!token) return;
    try {
      const state = await api("/api/state");
      if (role === "court" && isCourtDirty()) return;
      if (canRenderNow()) render(state);
    } catch (e) {
      // server session zneplatnil (unbind / jiný tablet)
      clearSession();
      setView(false);
      appView.innerHTML = "";
    }
  }, 5000); // každých 5 s
}

boot();

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function clampScore(n) {
  n = Number(n);
  if (!Number.isFinite(n)) n = 0;
  return Math.max(0, Math.min(99, Math.trunc(n)));
}

function scoreStepper(id, key, value, label) {
  // key např. s1a, s1b...
  const v = clampScore(value);
  return `
    <div class="stepper">
      <div class="stepperLabel">${label}</div>
      <div class="stepperRow">
        <button class="btn ghost stepBtn" type="button" id="${key}-minus-${id}">−</button>
        <div class="stepValue" id="${key}-val-${id}" data-v="${v}">${v}</div>
        <button class="btn ghost stepBtn" type="button" id="${key}-plus-${id}">+</button>
      </div>
    </div>
  `;
}

function getStepValue(courtId, key) {
  const el = document.getElementById(`${key}-val-${courtId}`);
  if (!el) return 0;
  return clampScore(el.getAttribute("data-v"));
}

function setStepValue(courtId, key, newVal) {
  const el = document.getElementById(`${key}-val-${courtId}`);
  if (!el) return;
  const v = clampScore(newVal);
  el.setAttribute("data-v", String(v));
  el.textContent = String(v);
}

function wireStepper(courtId, key) {
  const minus = document.getElementById(`${key}-minus-${courtId}`);
  const plus = document.getElementById(`${key}-plus-${courtId}`);

  minus?.addEventListener("click", () => {
    markCourtDirty();
    setStepValue(courtId, key, getStepValue(courtId, key) - 1);
  });

  plus?.addEventListener("click", () => {
    markCourtDirty();
    setStepValue(courtId, key, getStepValue(courtId, key) + 1);
  });
}

function render(state) {
  const courts = Array.isArray(state?.courts) ? state.courts : [];

  let visible = courts;

  if (role === "court") {
    visible = courts.filter(c => c.id === courtId);
  } else if (role === "admin") {
    visible = courts.filter(c => c.id === adminCourt);
    renderAdminTabs(); // aby se správně přepnul "active" stav tlačítek
  } else if (role === "display") {
    visible = courts; // všechny 3
  }

  // layout: display 3 sloupce, admin/court 1 sloupec
  appView.style.gridTemplateColumns = (role === "display") ? "repeat(3, 1fr)" : "1fr";

  appView.innerHTML = visible.map(c => courtPanel(c)).join("");
  visible.forEach(c => wirePanel(c.id));
}

function courtPanel(c) {
  const title = `<div class="small">Kurt ${c.id}</div>`;
  const badge = `<span class="badge-${c.status}">${escapeHtml(c.status)}</span>`;
  const names = (c.teamA || c.teamB)
    ? `<div class="small"><strong>${escapeHtml(c.teamA || "—")}</strong> vs <strong>${escapeHtml(c.teamB || "—")}</strong></div>`
    : `<div class="small">Bez přiřazených hráčů</div>`;

  const typeLabel = c.matchType === "doubles" ? "Čtyřhra" : "Dvouhra";
  const meta = `
    <div class="small">${typeLabel}${c.matchNote ? " • " + escapeHtml(c.matchNote) : ""}</div>
  `;
  const batteryLine = c.battery
  ? `<div class="small">
      Baterie: ${c.battery.level}% ${c.battery.charging ? "⚡" : ""}
     </div>`
  : "";
  const scoreView = `
    <div class="sep"></div>
    <div>
      <div class="small">Skóre setů</div>
      <div class="small">
        <strong>${c.s1a}:${c.s1b}</strong>
        &nbsp;
        <strong>${c.s2a}:${c.s2b}</strong>
        &nbsp;
        <strong>${c.s3a}:${c.s3b}</strong>
      </div>
      ${c.note ? `<div class="small">Pozn.: ${escapeHtml(c.note)}</div>` : ""}
    </div>
  `;

  const next = Array.isArray(c.queue) && c.queue.length ? c.queue[0] : null;
  const nextLine = next
  ? `<div class="small next-line">Další: <strong>${escapeHtml(next.teamA || "—")}</strong> vs <strong>${escapeHtml(next.teamB || "—")}</strong> ${next.matchType === "doubles" ? "(Čtyřhra)" : "(Dvouhra)"}${next.matchNote ? " • " + escapeHtml(next.matchNote) : ""}</div>`
  : `<div class="small next-line">Další: —</div>`;

  const org = (role === "admin") ? displayControls(c) : "";
  const court = (role === "court") ? courtControls(c) : "";

  return `
    <section class="panel" id="panel-${c.id}">
      <h3>${title} ${badge}</h3>
      ${names}
      ${meta}
      ${batteryLine}
      ${scoreView}
      ${role === "display" ? nextLine : ""}
      ${org}
      ${court}
    </section>
  `;
}

function queueRow(courtId, q, idx) {
  const typeLabel = q.matchType === "doubles" ? "Čtyřhra" : "Dvouhra";
  const label =
    `${q.teamA || "—"} vs ${q.teamB || "—"} • ${typeLabel}` +
    (q.matchNote ? ` • ${q.matchNote}` : "");

  return `
    <div class="row" style="justify-content:space-between; gap:8px;">
      <div class="small" style="flex:1;">${escapeHtml(label)}</div>
      <div class="row" style="gap:6px;">
        <button class="btn ghost" type="button" id="qUp-${courtId}-${idx}">↑</button>
        <button class="btn ghost" type="button" id="qDown-${courtId}-${idx}">↓</button>
        <button class="btn" type="button" id="qEdit-${courtId}-${idx}">Edit</button>
        <button class="btn warn" type="button" id="qDel-${courtId}-${idx}">X</button>
      </div>
    </div>
  `;
}

function displayControls(c) {
  const q = Array.isArray(c.queue) ? c.queue : [];
  const queueHtml = q.length
    ? q.map((it, idx) => queueRow(c.id, it, idx)).join("")
    : `<div class="small">Fronta je prázdná</div>`;

  return `
    <div class="sep"></div>
    <div class="small">Organizace (jen DISPLAY)</div>

    <div class="scoregrid">
      <div>
        <label>Hráč/Team A</label>
        <input id="teamA-${c.id}" value="" placeholder="např. Novák / Dvořák" />
      </div>
      <div>
        <label>Hráč/Team B</label>
        <input id="teamB-${c.id}" value="" placeholder="např. Svoboda / Černý" />
      </div>

      <div>
        <label>Typ</label>
        <select id="matchType-${c.id}">
          <option value="singles" ${c.matchType === "singles" ? "selected" : ""}>Dvouhra</option>
          <option value="doubles" ${c.matchType === "doubles" ? "selected" : ""}>Čtyřhra</option>
        </select>
      </div>

      <div style="grid-column:1 / -1;">
        <label>Poznámka k zápasu</label>
        <input id="matchNote-${c.id}" value="" placeholder="např. finále / mix / liga..." />
      </div>

      <div>
        <label>Stav</label>
        <select id="status-${c.id}">
          ${["čeká", "hra", "dohráno"].map(s => `<option value="${s}" ${c.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="row" style="margin-top:10px;">
      <button class="btn" id="saveAssign-${c.id}">Uložit hráče</button>
      <button class="btn warn" id="reset-${c.id}">Reset</button>
      <button class="btn ghost" id="unbindCourt-${c.id}">Uvolnit tablet</button>
      <button class="btn ghost" id="queueAdd-${c.id}">Přidat do fronty</button>
      <button class="btn warn" id="next-${c.id}">Další zápas</button>
    </div>

    <div class="sep"></div>
    <div class="small">Fronta: <span id="qcount-${c.id}">${q.length}</span></div>
    <div style="display:flex; flex-direction:column; gap:8px; margin-top:8px;">
      ${queueHtml}
    </div>
  `;
}

function courtControls(c) {
  return `
    <div class="sep"></div>
    <div class="small">Zápis skóre (jen COURT pro svůj kurt)</div>

    <div class="stepGrid">
      ${scoreStepper(c.id, "s1a", c.s1a, "Set 1 (A)")}
      ${scoreStepper(c.id, "s1b", c.s1b, "Set 1 (B)")}
      ${scoreStepper(c.id, "s2a", c.s2a, "Set 2 (A)")}
      ${scoreStepper(c.id, "s2b", c.s2b, "Set 2 (B)")}
      ${scoreStepper(c.id, "s3a", c.s3a, "Set 3 (A)")}
      ${scoreStepper(c.id, "s3b", c.s3b, "Set 3 (B)")}
    </div>

    <div class="scoregrid" style="margin-top:10px;">
      <div style="grid-column:1 / -1;">
        <label>Poznámka</label>
        <input id="note-${c.id}" value="${escapeHtml(c.note)}" placeholder="např. TB 10:8" />
      </div>
      <div style="grid-column:1 / -1;">
        <label>Stav</label>
        <select id="cstatus-${c.id}">
          ${["čeká","hra","dohráno"].map(s => `<option value="${s}" ${c.status===s?"selected":""}>${s}</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="row" style="margin-top:10px;">
      <button class="btn" id="saveScore-${c.id}">Uložit skóre</button>
    </div>
  `;
}

function wirePanel(id) {
  // ---------- ADMIN ----------
  if (role === "admin") {
    const save = document.getElementById(`saveAssign-${id}`);
    const reset = document.getElementById(`reset-${id}`);
    const next = document.getElementById(`next-${id}`);
    const queueAdd = document.getElementById(`queueAdd-${id}`);
    const unbind = document.getElementById(`unbindCourt-${id}`);

    save?.addEventListener("click", async () => {
  isSaving = true;
  try {
    const teamA = document.getElementById(`teamA-${id}`)?.value || "";
    const teamB = document.getElementById(`teamB-${id}`)?.value || "";
    const matchType = document.getElementById(`matchType-${id}`)?.value || "singles";
    const matchNote = document.getElementById(`matchNote-${id}`)?.value || "";
    const status = document.getElementById(`status-${id}`)?.value || "playing";

    await api(`/api/courts/${id}/assignment`, {
      method: "PUT",
      body: JSON.stringify({ teamA, teamB, matchType, matchNote, status })
    });
    clearAdminForm(id);
    // po úspěšném uložení dovol render
    markAdminDirty(0);
  } catch (e) {
    alert(e.message || "Uložení selhalo");
  } finally {
    isSaving = false;

    // pokud mezitím přišel update, a už nejsi vepsaný v inputu, promítni ho
    if (pendingState && !isEditingInApp()) {
      const st = pendingState;
      pendingState = null;
      render(st);
    }
  }
});

    queueAdd?.addEventListener("click", async () => {
      try {
        // Znovupoužijeme stejné inputy jako pro assignment
        const teamA = document.getElementById(`teamA-${id}`)?.value || "";
        const teamB = document.getElementById(`teamB-${id}`)?.value || "";
        const matchType = document.getElementById(`matchType-${id}`)?.value || "singles";
        const matchNote = document.getElementById(`matchNote-${id}`)?.value || "";

        await api(`/api/courts/${id}/queue`, {
          method: "POST",
          body: JSON.stringify({ teamA, teamB, matchType, matchNote })
        });
        clearAdminForm(id);
      } catch (e) {
        alert(e.message || "Nepodařilo se přidat do fronty");
      }
    });

    next?.addEventListener("click", async () => {
      const ok = confirm(`Posunout kurt ${id} na další zápas z fronty? (Resetuje skóre a nasadí další dvojici)`);
      if (!ok) return;

      try {
        await api(`/api/courts/${id}/next`, { method: "POST" });
      } catch (e) {
        alert(e.message || "Fronta je prázdná / posun selhal");
      }
    });

    reset?.addEventListener("click", async () => {
      const ok = confirm(`Resetovat kurt ${id}?`);
      if (!ok) return;
      try {
        await api(`/api/courts/${id}/reset`, { method: "POST" });
      } catch (e) {
        alert(e.message || "Reset selhal");
      }
    });

    unbind?.addEventListener("click", async () => {
      const ok = confirm(`Uvolnit párování tabletu pro K${id}? (Pak půjde K${id} přihlásit na jiném zařízení)`);
      if (!ok) return;

      try {
        await api(`/api/unbind/court${id}`, { method: "POST" });
        alert(`K${id} bylo uvolněno. Na novém tabletu se znovu přihlas kódem K${id}.`);
      } catch (e) {
        alert(e.message || "Uvolnění selhalo");
      }
    });
    // Queue handlers (admin)
const panel = document.getElementById(`panel-${id}`);
const qButtons = panel?.querySelectorAll(`[id^="qEdit-${id}-"], [id^="qDel-${id}-"], [id^="qUp-${id}-"], [id^="qDown-${id}-"]`) || [];
qButtons.forEach(btn => {
  btn.addEventListener("click", async () => {
    const bid = btn.id;

    const m = bid.match(/^(qEdit|qDel|qUp|qDown)-(\d+)-(\d+)$/);
    if (!m) return;
    const action = m[1];
    const courtId = Number(m[2]);
    const idx = Number(m[3]);

    try {
      if (action === "qDel") {
        const ok = confirm("Smazat položku z fronty?");
        if (!ok) return;
        await api(`/api/courts/${courtId}/queue/${idx}`, { method: "DELETE" });
        return;
      }

      if (action === "qUp") {
        await api(`/api/courts/${courtId}/queue/${idx}/move`, {
          method: "POST",
          body: JSON.stringify({ dir: "up" })
        });
        return;
      }

      if (action === "qDown") {
        await api(`/api/courts/${courtId}/queue/${idx}/move`, {
          method: "POST",
          body: JSON.stringify({ dir: "down" })
        });
        return;
      }

      if (action === "qEdit") {
        // jednoduchý edit přes prompt (nejrychlejší implementace)
        // Pokud chceš hezčí UI, uděláme inline edit formulář.
        const teamA = prompt("Team A (původně):", "") ?? null;
        if (teamA === null) return;
        const teamB = prompt("Team B:", "") ?? null;
        if (teamB === null) return;
        const mt = prompt("Typ: singles/doubles", "singles") ?? null;
        if (mt === null) return;
        const matchNote = prompt("Poznámka:", "") ?? null;
        if (matchNote === null) return;

        await api(`/api/courts/${courtId}/queue/${idx}`, {
          method: "PUT",
          body: JSON.stringify({
            teamA,
            teamB,
            matchType: (mt === "doubles") ? "doubles" : "singles",
            matchNote
          })
        });
      }
    } catch (e) {
      alert(e.message || "Akce selhala");
    }
  });
});
  }

  // ---------- COURT ----------
  if (role === "court") {
    ["s1a", "s1b", "s2a", "s2b", "s3a", "s3b"].forEach((k) => wireStepper(id, k));

    const save = document.getElementById(`saveScore-${id}`);
    save?.addEventListener("click", async () => {
      isSaving = true;
      try {
        const s1a = getStepValue(id, "s1a");
        const s1b = getStepValue(id, "s1b");
        const s2a = getStepValue(id, "s2a");
        const s2b = getStepValue(id, "s2b");
        const s3a = getStepValue(id, "s3a");
        const s3b = getStepValue(id, "s3b");

        const note = document.getElementById(`note-${id}`)?.value || "";
        const status = document.getElementById(`cstatus-${id}`)?.value || "čeká";

        const battery = navigator.getBattery
  ? await navigator.getBattery()
  : null;
  console.log(battery);
  const newState = await api(`/api/courts/${id}/score`, {
    method: "PUT",
    body: JSON.stringify({
      s1a,
      s1b,
      s2a,
      s2b,
      s3a,
      s3b,
      note,
      status,
      battery: battery ? {
        level: Math.round(battery.level * 100),
        charging: battery.charging
      } : null
    })
  });

        courtDirtyUntil = 0;
        pendingState = null;
        render(newState);
      } catch (e) {
        alert(e.message || "Uložení selhalo");
      } finally {
        isSaving = false;
        if (!isEditingInApp?.() && pendingState) {
          const st = pendingState;
          pendingState = null;
          render(st);
        }
      }
    });
  }
}
  pendingState = null;
