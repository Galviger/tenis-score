// server.js (JSON persistence, žádné nativní moduly)
// Spuštění: npm install && npm start
// URL: http://localhost:3000  (a z tabletů http://IP-notebooku:3000)

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const os = require("os");

const IS_PKG = !!process.pkg;
const BASE_DIR = IS_PKG ? path.dirname(process.execPath) : __dirname;
global.DATA_FILE = path.join(BASE_DIR, "data.json");
//const DATA_FILE = path.join(path.dirname(process.execPath), "data.json");
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const DEFAULT_STATE = {
  deviceBindings: {
    court1: null,
    court2: null,
    court3: null,
    display: "b88097bd-a0ca-4388-ac52-9e4f5361bdd7"
  },
  courts: [
    { id: 1, teamA: "", teamB: "", category: "", status: "čeká",
      matchType: "singles",
      matchNote: "",
      queue: [],
      s1a: 0, s1b: 0, s2a: 0, s2b: 0, s3a: 0, s3b: 0, note: "", updatedAt: Date.now() },
    { id: 2, teamA: "", teamB: "", category: "", status: "čeká",
      matchType: "singles",
      matchNote: "",
      queue: [],
      s1a: 0, s1b: 0, s2a: 0, s2b: 0, s3a: 0, s3b: 0, note: "", updatedAt: Date.now() },
    { id: 3, teamA: "", teamB: "", category: "", status: "čeká",
      matchType: "singles",
      matchNote: "",
      queue: [],
      s1a: 0, s1b: 0, s2a: 0, s2b: 0, s3a: 0, s3b: 0, note: "", updatedAt: Date.now() }
  ]
};
// Přístupové kódy (prototyp). Později dej klidně do .env
const CODES = {
  K1: { role: "court", courtId: 1 },
  K2: { role: "court", courtId: 2 },
  K3: { role: "court", courtId: 3 },
  A:  { role: "admin" },
  D:  { role: "display" } // nově jen read-only
};

// Pokud chceš vypnout omezení jen na lokální síť: nastav REQUIRE_LOCAL=0
const REQUIRE_LOCAL = process.env.REQUIRE_LOCAL !== "0";

// Jen jedno aktivní display zařízení
let activeDisplayToken = null;

// Session tokeny v paměti (pro prototyp OK)
const sessions = new Map(); // token -> { role, courtId|null, createdAt }

// ---------- Helpers ----------
function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

function isLocalIp(ipRaw) {
  const ip = String(ipRaw || "").replace("::ffff:", "");

  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;

  if (ip.startsWith("172.")) {
    const parts = ip.split(".");
    if (parts.length >= 2) {
      const n = Number(parts[1]);
      if (n >= 16 && n <= 31) return true;
    }
  }
  return false;
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "Missing Bearer token" });

  const token = m[1];
  const sess = sessions.get(token);
  if (!sess) return res.status(401).json({ error: "Invalid token" });

  req.session = { token, ...sess };
  // 🔒 binding enforcement (když je role unbindnutá, session zneplatníme)
if (state.deviceBindings) {
  let bindingKey = null;

  if (req.session.role === "display") bindingKey = "display";
  else if (req.session.role === "court") {
    bindingKey =
      req.session.courtId === 1 ? "court1" :
      req.session.courtId === 2 ? "court2" :
      "court3";
  }

  if (bindingKey) {
    const bound = state.deviceBindings[bindingKey];
    if (!bound || bound !== req.session.deviceId) {
      sessions.delete(token);
      return res.status(401).json({ error: "Session no longer valid for this device" });
    }
  }
}
  // 🔒 vynutit, že token je pořád svázaný s aktuálním device bindingem
if (state.deviceBindings) {
  let bindingKey = null;

  if (req.session.role === "display") {
    bindingKey = "display";
  } else if (req.session.role === "court") {
    bindingKey =
      req.session.courtId === 1 ? "court1" :
      req.session.courtId === 2 ? "court2" :
      "court3";
  }

  if (bindingKey) {
    const bound = state.deviceBindings[bindingKey]; // může být null
    // Pokud není svázáno, nebo je svázáno s jiným zařízením, session je neplatná
    if (!bound || bound !== req.session.deviceId) {
      sessions.delete(token);
      return res.status(401).json({ error: "Session no longer valid for this device" });
    }
  }
}
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session || req.session.role !== role) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

function requireCourtAccess(paramName = "id") {
  return (req, res, next) => {
    const cid = Number(req.params[paramName]);
    if (!Number.isInteger(cid) || cid < 1 || cid > 3) {
      return res.status(400).json({ error: "Invalid court id" });
    }
    if (req.session.role !== "court" || req.session.courtId !== cid) {
      return res.status(403).json({ error: "Forbidden (wrong court)" });
    }
    next();
  };
}

function clampInt(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(99, Math.trunc(n)));
}

function getLocalIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

async function telegramNotify(text) {
  const token = "8644049892:AAFAS2-AC1O4BFofftRBE9IVcGnJAiYtZuw";
  const chatId = "8223002871";
  if (!token || !chatId) return;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn("Telegram notify failed:", res.status, body);
  }
}

// ---------- "DB" do JSON souboru ----------
function defaultState() {
  return {
    deviceBindings: {
        court1: null,
        court2: null,
        court3: null,
        admin: null,
        display: null
    },
    courts: [1, 2, 3].map((id) => ({
      id,
      teamA: "",
      teamB: "",
      category: "",
      status: "čeká",
      matchType: "singles",
      matchNote: "",
      queue: [],
      s1a: 0, s1b: 0,
      s2a: 0, s2b: 0,
      s3a: 0, s3b: 0,
      note: "",
      updatedAt: Date.now()
    }))
  };
}

function loadState() {
  if (!fs.existsSync(global.DATA_FILE)) {
    fs.writeFileSync(
      global.DATA_FILE,
      JSON.stringify(DEFAULT_STATE, null, 2),
      "utf8"
    );
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
  try {
    const raw = fs.readFileSync(global.DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);

    // 🔹 pokud chybí deviceBindings (starý data.json), doplníme
    if (!parsed.deviceBindings) {
      parsed.deviceBindings = {
        court1: null,
        court2: null,
        court3: null,
        admin: null,
        display: null
      };
    }
    else {
        parsed.deviceBindings.admin ??= null;
        parsed.deviceBindings.display ??= null;
    }

    // základní kontrola courts
    if (!Array.isArray(parsed.courts) || parsed.courts.length !== 3) {
      return defaultState();
    }

    // normalizace courtů
    parsed.courts = parsed.courts
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((c, idx) => ({
        id: idx + 1,
        teamA: String(c.teamA ?? ""),
        teamB: String(c.teamB ?? ""),
        category: String(c.category ?? ""),
        status: ["čeká", "hra", "dohráno"].includes(c.status)
          ? c.status
          : "čeká",
        matchType: (c.matchType === "doubles" || c.matchType === "singles") ? c.matchType : "singles",
        matchNote: String(c.matchNote ?? c.category ?? "").slice(0, 200),
        queue: Array.isArray(c.queue) ? c.queue.slice(0, 20).map((q) => ({
          teamA: String(q.teamA ?? "").trim(),
          teamB: String(q.teamB ?? "").trim(),
          matchType: (q.matchType === "doubles" || q.matchType === "singles") ? q.matchType : "singles",
          matchNote: String(q.matchNote ?? "").trim().slice(0, 200),
        })) : [],
        s1a: clampInt(c.s1a), s1b: clampInt(c.s1b),
        s2a: clampInt(c.s2a), s2b: clampInt(c.s2b),
        s3a: clampInt(c.s3a), s3b: clampInt(c.s3b),
        note: String(c.note ?? "").slice(0, 200),
        updatedAt: Number(c.updatedAt) || Date.now()
      }));

    return parsed;
  } catch (err) {
    return defaultState();
  }
}

function saveState(state) {
  fs.writeFileSync(global.DATA_FILE, JSON.stringify(state, null, 2), "utf8");
}

let state = loadState();

function getCourt(id) {
  return state.courts.find((c) => c.id === id) || null;
}

function statePayload() {
  return { courts: state.courts, serverTime: Date.now() };
}

// ---------- App ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// pouze lokální síť (volitelně)
app.use((req, res, next) => {
  if (REQUIRE_LOCAL) {
    const ip = req.ip || req.connection?.remoteAddress || "";
    if (!isLocalIp(ip)) return res.status(403).send("Local network only");
  }
  next();
});

// ---------- API ----------

// login přes kód zařízení
app.post("/api/login", (req, res) => {
  const { code, takeover, deviceId, password } = req.body || {};
  const dev = String(deviceId || "").trim();
  if (!dev) return res.status(400).json({ error: "Missing deviceId" });

  const entry = CODES[String(code || "").trim()];
  if (!entry) return res.status(401).json({ error: "Bad code" });

  // ✅ Admin login pouze přes heslo (bez device bindingu)
  if (entry.role === "admin") {
    const expected = "Tenis"; // nebo z env
    if (String(password || "") !== expected) {
      return res.status(401).json({ error: "Bad admin password" });
    }
  }

  // ✅ Device binding enforcement jen pro court/display
  if (entry.role === "display" || entry.role === "court") {
    const bindingKey =
      entry.role === "display" ? "display" :
      entry.courtId === 1 ? "court1" :
      entry.courtId === 2 ? "court2" :
      "court3";

    const bound = state.deviceBindings?.[bindingKey] ?? null;

    if (bound && bound !== dev) {
      return res.status(403).json({
        error: "Na tuto roli je již připojené jiné zařízení",
        bound: true
      });
    }

    if (!bound) {
      state.deviceBindings[bindingKey] = dev;
      saveState(state);
    }
  }

  const token = newToken();
  const sess = {
    role: entry.role,
    courtId: entry.courtId || null,
    deviceId: dev,
    createdAt: Date.now()
  };

  // single-display enforcement
  if (sess.role === "display") {
    if (activeDisplayToken && activeDisplayToken !== token) {
      if (!takeover) {
        return res.status(409).json({
          error: "Display already active",
          hint: "Send takeover=true to replace current display session."
        });
      }
      sessions.delete(activeDisplayToken);
    }
    activeDisplayToken = token;
  }

  sessions.set(token, sess);
  res.json({ token, ...sess });
});

// načtení stavu
app.get("/api/state", requireAuth, (req, res) => {
  res.json(statePayload());
});

// DISPLAY: přiřazení hráčů/kategorie/stavu
app.put("/api/courts/:id/assignment", requireAuth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1 || id > 3) return res.status(400).json({ error: "Invalid court id" });

  const c = getCourt(id);
  if (!c) return res.status(404).json({ error: "Not found" });

  if (typeof req.body.teamA === "string" && req.body.teamA.trim() !== "") {
  c.teamA = req.body.teamA.trim();
}

if (typeof req.body.teamB === "string" && req.body.teamB.trim() !== "") {
  c.teamB = req.body.teamB.trim();
}

if (typeof req.body.matchType === "string" && ["singles", "doubles"].includes(req.body.matchType)) {
  c.matchType = req.body.matchType;
}

// poznámka se může změnit i na prázdnou
if (typeof req.body.matchNote === "string" && req.body.matchNote.trim() !== "") {
  c.matchNote = req.body.matchNote.trim().slice(0, 200);
}

// category – podle toho jak to chceš:
if (typeof req.body.category === "string" && req.body.category.trim() !== "") {
  c.category = req.body.category.trim();
}

  let status = String(req.body.status ?? "hra").trim();
  if (!["čeká", "hra", "dohráno"].includes(status)) status = "hra";
  c.status = status;

  c.updatedAt = Date.now();
  saveState(state);

  const payload = statePayload();
  io.emit("state", payload);
  res.json(payload);
});

// COURT: zápis skóre (jen vlastní kurt)
app.put("/api/courts/:id/score", requireAuth, requireCourtAccess("id"), (req, res) => {
  const id = Number(req.params.id);
  const c = getCourt(id);
  if (!c) return res.status(404).json({ error: "Not found" });

  c.s1a = clampInt(req.body.s1a);
  c.s1b = clampInt(req.body.s1b);
  c.s2a = clampInt(req.body.s2a);
  c.s2b = clampInt(req.body.s2b);
  c.s3a = clampInt(req.body.s3a);
  c.s3b = clampInt(req.body.s3b);

  c.matchType = (req.body.matchType === "doubles") ? "doubles" : "singles";
  c.matchNote = String(req.body.matchNote ?? "").trim().slice(0, 200);
  c.note = String(req.body.note ?? "").slice(0, 200);

  let status = String(req.body.status ?? "hra").trim();
  if (!["čeká", "hra", "dohráno"].includes(status)) status = "hra";
  c.status = status;

  if (req.body.battery) {
  c.battery = {
    level: Number(req.body.battery.level) || 0,
    charging: !!req.body.battery.charging,
    updatedAt: Date.now()
  };
}

  c.updatedAt = Date.now();
  saveState(state);

  const payload = statePayload();
  io.emit("state", payload);
  res.json(payload);
});

// DISPLAY: reset kurtu
app.post("/api/courts/:id/reset", requireAuth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const c = getCourt(id);
  if (!c) return res.status(404).json({ error: "Not found" });

  c.teamA = "";
  c.teamB = "";
  c.category = "";
  c.status = "čeká";
  c.s1a = 0; c.s1b = 0;
  c.s2a = 0; c.s2b = 0;
  c.s3a = 0; c.s3b = 0;
  c.note = "";
  c.updatedAt = Date.now();

  saveState(state);

  const payload = statePayload();
  io.emit("state", payload);
  res.json(payload);
});

// DISPLAY: uvolnit párování zařízení (např. při výměně tabletu)
app.post(
  "/api/unbind/:what",
  requireAuth,
  requireRole("admin"),
  (req, res) => {
    const what = String(req.params.what || "").trim();
    if (!state.deviceBindings) {
      state.deviceBindings = {
        court1: null,
        court2: null,
        court3: null,
        display: null
      };
    }

    if (what === "all") {
      state.deviceBindings = {
        court1: null,
        court2: null,
        court3: null,
        admin: null,
        display: null
      };
      if (activeDisplayToken) {
        sessions.delete(activeDisplayToken);
        activeDisplayToken = null;
      }
    } else if (["court1", "court2", "court3", "display"].includes(what)) {
      state.deviceBindings[what] = null;
      if (what === "display") {
        if (activeDisplayToken) {
        sessions.delete(activeDisplayToken);
        activeDisplayToken = null;
        }
      }
    } else {
      return res.status(400).json({ error: "Invalid target" });
    }

    saveState(state);
    res.json({ ok: true, deviceBindings: state.deviceBindings });
  }
);

// socket: poslat stav po připojení
io.on("connection", (socket) => {
  socket.emit("state", statePayload());
});

server.listen(PORT, async () => {
  console.log(`Tenis scoreboard running on http://0.0.0.0:${PORT}`);
  console.log(`Local-only mode: ${REQUIRE_LOCAL ? "ON" : "OFF"}`);

  // Telegram zpráva s URL (po startu)
  try {
    const ip = getLocalIPv4();
    if (ip) {
      await telegramNotify(`Tenis server běží: http://${ip}:${PORT}`);
    }
  } catch (e) {
    console.warn("Notify error:", e?.message || e);
  }
});
app.post("/api/courts/:id/queue", requireAuth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1 || id > 3) return res.status(400).json({ error: "Invalid court id" });

  const c = getCourt(id);
  if (!c) return res.status(404).json({ error: "Not found" });

  const item = {
    teamA: String(req.body.teamA ?? "").trim(),
    teamB: String(req.body.teamB ?? "").trim(),
    matchType: (req.body.matchType === "doubles") ? "doubles" : "singles",
    matchNote: String(req.body.matchNote ?? "").trim().slice(0, 200),
  };

  if (!item.teamA && !item.teamB) return res.status(400).json({ error: "Missing teams" });

  c.queue = Array.isArray(c.queue) ? c.queue : [];
  c.queue.push(item);
  c.queue = c.queue.slice(0, 20); // limit
  c.updatedAt = Date.now();

  saveState(state);
  const payload = statePayload();
  io.emit("state", payload);
  res.json(payload);
});
app.put("/api/courts/:id/queue/:idx", requireAuth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const idx = Number(req.params.idx);

  if (!Number.isInteger(id) || id < 1 || id > 3) return res.status(400).json({ error: "Invalid court id" });
  if (!Number.isInteger(idx) || idx < 0) return res.status(400).json({ error: "Invalid queue index" });

  const c = getCourt(id);
  if (!c) return res.status(404).json({ error: "Not found" });

  c.queue = Array.isArray(c.queue) ? c.queue : [];
  if (idx >= c.queue.length) return res.status(404).json({ error: "Queue item not found" });

  const item = {
    teamA: String(req.body.teamA ?? "").trim(),
    teamB: String(req.body.teamB ?? "").trim(),
    matchType: (req.body.matchType === "doubles") ? "doubles" : "singles",
    matchNote: String(req.body.matchNote ?? "").trim().slice(0, 200),
  };

  if (!item.teamA && !item.teamB) return res.status(400).json({ error: "Missing teams" });

  c.queue[idx] = item;
  c.updatedAt = Date.now();

  saveState(state);
  const payload = statePayload();
  io.emit("state", payload);
  res.json(payload);
});
app.delete("/api/courts/:id/queue/:idx", requireAuth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const idx = Number(req.params.idx);

  if (!Number.isInteger(id) || id < 1 || id > 3) return res.status(400).json({ error: "Invalid court id" });
  if (!Number.isInteger(idx) || idx < 0) return res.status(400).json({ error: "Invalid queue index" });

  const c = getCourt(id);
  if (!c) return res.status(404).json({ error: "Not found" });

  c.queue = Array.isArray(c.queue) ? c.queue : [];
  if (idx >= c.queue.length) return res.status(404).json({ error: "Queue item not found" });

  c.queue.splice(idx, 1);
  c.updatedAt = Date.now();

  saveState(state);
  const payload = statePayload();
  io.emit("state", payload);
  res.json(payload);
});
app.post("/api/courts/:id/next", requireAuth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1 || id > 3) return res.status(400).json({ error: "Invalid court id" });

  const c = getCourt(id);
  if (!c) return res.status(404).json({ error: "Not found" });

  c.queue = Array.isArray(c.queue) ? c.queue : [];
  const next = c.queue.shift();
  if (!next) return res.status(409).json({ error: "Queue empty" });

  c.teamA = next.teamA;
  c.teamB = next.teamB;
  c.matchType = next.matchType;
  c.matchNote = next.matchNote;

  c.status = "čeká"; // nebo "waiting"
  c.s1a = 0; c.s1b = 0;
  c.s2a = 0; c.s2b = 0;
  c.s3a = 0; c.s3b = 0;
  c.note = "";
  c.updatedAt = Date.now();

  saveState(state);
  const payload = statePayload();
  io.emit("state", payload);
  res.json(payload);
});
app.post("/api/courts/:id/queue/:idx/move", requireAuth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const idx = Number(req.params.idx);
  const dir = String(req.body?.dir || "");

  if (!Number.isInteger(id) || id < 1 || id > 3)
    return res.status(400).json({ error: "Invalid court id" });

  if (!Number.isInteger(idx))
    return res.status(400).json({ error: "Invalid index" });

  const c = getCourt(id);
  if (!c) return res.status(404).json({ error: "Court not found" });

  c.queue = Array.isArray(c.queue) ? c.queue : [];

  if (idx < 0 || idx >= c.queue.length)
    return res.status(404).json({ error: "Queue item not found" });

  if (dir === "up" && idx > 0) {
    const tmp = c.queue[idx - 1];
    c.queue[idx - 1] = c.queue[idx];
    c.queue[idx] = tmp;
  }

  if (dir === "down" && idx < c.queue.length - 1) {
    const tmp = c.queue[idx + 1];
    c.queue[idx + 1] = c.queue[idx];
    c.queue[idx] = tmp;
  }

  c.updatedAt = Date.now();
  saveState(state);

  const payload = statePayload();
  io.emit("state", payload);
  res.json(payload);
});