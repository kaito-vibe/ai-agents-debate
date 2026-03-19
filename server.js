const http = require("http");
const fs = require("fs");
const path = require("path");

const START_PORT = 3000;
const MAX_PORT = 3010;

// When packaged with pkg:
//   __dirname  → snapshot filesystem (read-only, contains bundled index.html)
//   EXE_DIR    → real directory where the .exe lives (writable)
// When running normally both point to the same place.
const IS_PKG = typeof process.pkg !== "undefined";
const EXE_DIR = IS_PKG ? path.dirname(process.execPath) : __dirname;
const STATIC_DIR = __dirname; // always points to where index.html is (snapshot in pkg)

// Keep console window open on crash so user can read the error
function fatal(msg) {
  console.error("\n  ERROR: " + msg + "\n");
  if (IS_PKG) {
    console.log("  Press any key to exit...\n");
    process.stdin.setRawMode && process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", () => process.exit(1));
  } else {
    process.exit(1);
  }
}
process.on("uncaughtException", (e) => fatal(e.message));
process.on("unhandledRejection", (e) => fatal(e?.message || String(e)));

const SAVES_DIR = path.join(EXE_DIR, "saves");
const PERSONAS_FILE = path.join(SAVES_DIR, "_personas.json");
const SETTINGS_FILE = path.join(SAVES_DIR, "_settings.json");
const MAX_BODY = 10 * 1024 * 1024; // 10MB limit

if (!fs.existsSync(SAVES_DIR)) fs.mkdirSync(SAVES_DIR, { recursive: true });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ""; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error("Body too large")); req.destroy(); } else b += c; });
    req.on("end", () => resolve(b));
  });
}
function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(data));
}
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return fallback; }
}

const requestHandler = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ── Allowed API domains (SSRF whitelist) ──
  const ALLOWED_API_DOMAINS = ["api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com"];
  function checkDomain(url) {
    try {
      const h = new URL(url).hostname;
      return ALLOWED_API_DOMAINS.some(d => h === d || h.endsWith("." + d));
    } catch { return false; }
  }

  // ── API Proxy (non-streaming) ──
  if (req.method === "POST" && req.url === "/api/proxy") {
    let body;
    try { body = await readBody(req); } catch (e) { json(res, 413, { error: { message: e.message } }); return; }
    try {
      const { url, headers, body: payload } = JSON.parse(body);
      if (!checkDomain(url)) { json(res, 403, { error: { message: "API domain not permitted" } }); return; }
      const apiUrl = new URL(url);
      const proto = apiUrl.protocol === "https:" ? require("https") : require("http");
      const apiReq = proto.request({
        hostname: apiUrl.hostname, port: apiUrl.port || (apiUrl.protocol === "https:" ? 443 : 80),
        path: apiUrl.pathname + apiUrl.search, method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
      }, (apiRes) => {
        let data = ""; apiRes.on("data", (c) => (data += c));
        apiRes.on("end", () => { res.writeHead(apiRes.statusCode, { "Content-Type": "application/json" }); res.end(data); });
      });
      apiReq.on("error", (e) => json(res, 500, { error: { message: e.message } }));
      apiReq.write(JSON.stringify(payload)); apiReq.end();
    } catch (e) { json(res, 400, { error: { message: e.message } }); }
    return;
  }

  // ── API Proxy (streaming SSE) ──
  if (req.method === "POST" && req.url === "/api/proxy-stream") {
    let body;
    try { body = await readBody(req); } catch (e) { json(res, 413, { error: { message: e.message } }); return; }
    try {
      const { url, headers, body: payload } = JSON.parse(body);
      if (!checkDomain(url)) { json(res, 403, { error: { message: "API domain not permitted" } }); return; }
      payload.stream = true;
      const apiUrl = new URL(url);
      const proto = apiUrl.protocol === "https:" ? require("https") : require("http");

      const apiReq = proto.request({
        hostname: apiUrl.hostname, port: apiUrl.port || (apiUrl.protocol === "https:" ? 443 : 80),
        path: apiUrl.pathname + apiUrl.search, method: "POST",
        headers: { ...headers, "Content-Type": "application/json", "Accept": "text/event-stream" },
      }, (apiRes) => {
        if (apiRes.statusCode !== 200) {
          let errData = "";
          apiRes.on("data", (c) => (errData += c));
          apiRes.on("end", () => {
            res.writeHead(apiRes.statusCode, { "Content-Type": "application/json" });
            res.end(errData);
          });
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });
        apiRes.on("data", (chunk) => { res.write(chunk); });
        apiRes.on("end", () => { res.end(); });
        apiRes.on("error", () => { res.end(); });
      });
      apiReq.on("error", (e) => {
        try { json(res, 500, { error: { message: e.message } }); } catch (_) {}
      });
      apiReq.write(JSON.stringify(payload)); apiReq.end();
    } catch (e) { json(res, 400, { error: { message: e.message } }); }
    return;
  }

  // ── Settings ──
  if (req.method === "GET" && req.url === "/api/settings") {
    json(res, 200, readJSON(SETTINGS_FILE, {}));
    return;
  }
  if (req.method === "POST" && req.url === "/api/settings") {
    let body;
    try { body = await readBody(req); } catch (e) { json(res, 413, { error: e.message }); return; }
    try {
      const settings = JSON.parse(body);
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
      json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return;
  }

  // ── Personas ──
  if (req.method === "GET" && req.url === "/api/personas") {
    json(res, 200, readJSON(PERSONAS_FILE, []));
    return;
  }
  if (req.method === "POST" && req.url === "/api/personas") {
    let body;
    try { body = await readBody(req); } catch (e) { json(res, 413, { error: e.message }); return; }
    try {
      const persona = JSON.parse(body);
      const personas = readJSON(PERSONAS_FILE, []);
      const id = persona.id || persona.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
      persona.id = id;
      persona.updatedAt = new Date().toISOString();
      const idx = personas.findIndex((p) => p.id === id);
      if (idx >= 0) personas[idx] = { ...personas[idx], ...persona };
      else { persona.createdAt = persona.updatedAt; personas.push(persona); }
      fs.writeFileSync(PERSONAS_FILE, JSON.stringify(personas, null, 2));
      json(res, 200, { ok: true, id });
    } catch (e) { json(res, 400, { error: e.message }); }
    return;
  }
  if (req.method === "DELETE" && req.url.startsWith("/api/personas/")) {
    const id = decodeURIComponent(req.url.split("/api/personas/")[1]);
    const personas = readJSON(PERSONAS_FILE, []).filter((p) => p.id !== id);
    fs.writeFileSync(PERSONAS_FILE, JSON.stringify(personas, null, 2));
    json(res, 200, { ok: true });
    return;
  }

  // ── Saves (conversations) ──
  if (req.method === "GET" && req.url === "/api/saves") {
    try {
      const files = fs.readdirSync(SAVES_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
      const saves = files.map((f) => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(SAVES_DIR, f), "utf-8"));
          return {
            filename: f, name: d.name, savedAt: d.savedAt,
            participantCount: (d.state?.seats || []).filter(Boolean).length,
            messageCount: (d.state?.messages || []).length,
            topic: d.state?.topic || "",
            context: (d.state?.context || "").slice(0, 150),
            simMode: d.state?.simMode || "meeting",
            debateScore: d.state?.debateScore ?? null,
            debateScoreCount: (d.state?.debateScoreHistory || []).length,
            debateRound: d.state?.debateRound || 0,
            finished: d.state?.finished || false,
            scoreHistory: (d.state?.debateScoreHistory || []).map(h => ({ r: h.round, s: h.score })),
            summaryPreview: (d.state?.debateSummary || "").split(/[.!?]/)[0].trim().slice(0, 160),
          };
        } catch { return null; }
      }).filter(Boolean).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
      json(res, 200, saves);
    } catch (e) { json(res, 500, { error: e.message }); }
    return;
  }
  if (req.method === "POST" && req.url === "/api/saves") {
    let body;
    try { body = await readBody(req); } catch (e) { json(res, 413, { error: e.message }); return; }
    try {
      const { name, state } = JSON.parse(body);
      const safeName = (name || "meeting").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
      const ts = Date.now().toString(36);
      const filename = safeName + "_" + ts + ".json";
      fs.writeFileSync(path.join(SAVES_DIR, filename), JSON.stringify({
        name: name || "Untitled", savedAt: new Date().toISOString(), state,
      }, null, 2));
      json(res, 200, { ok: true, filename });
    } catch (e) { json(res, 400, { error: e.message }); }
    return;
  }
  if (req.method === "GET" && req.url.startsWith("/api/saves/")) {
    const fn = path.basename(decodeURIComponent(req.url.split("/api/saves/")[1]));
    try { json(res, 200, JSON.parse(fs.readFileSync(path.join(SAVES_DIR, fn), "utf-8"))); }
    catch { json(res, 404, { error: "Not found" }); }
    return;
  }
  if (req.method === "DELETE" && req.url.startsWith("/api/saves/")) {
    const fn = path.basename(decodeURIComponent(req.url.split("/api/saves/")[1]));
    try { fs.unlinkSync(path.join(SAVES_DIR, fn)); json(res, 200, { ok: true }); }
    catch { json(res, 404, { error: "Not found" }); }
    return;
  }

  // ── Autosave ──
  if (req.method === "POST" && req.url === "/api/autosave") {
    let body;
    try { body = await readBody(req); } catch (e) { json(res, 413, { error: e.message }); return; }
    try {
      fs.writeFileSync(path.join(SAVES_DIR, "_autosave.json"), JSON.stringify({
        name: "__autosave__", savedAt: new Date().toISOString(), state: JSON.parse(body),
      }, null, 2));
      json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return;
  }
  if (req.method === "GET" && req.url === "/api/autosave") {
    const f = path.join(SAVES_DIR, "_autosave.json");
    try { json(res, 200, JSON.parse(fs.readFileSync(f, "utf-8"))); }
    catch { json(res, 404, { error: "No autosave" }); }
    return;
  }

  // ── Static files ──
  let fp = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  fp = path.normalize(fp).replace(/^(\.\.[\/\\])+/, "");
  fp = path.join(STATIC_DIR, fp);
  if (!fp.startsWith(STATIC_DIR)) { res.writeHead(403); res.end("Forbidden"); return; }
  const ext = path.extname(fp);
  const mt = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon" };
  fs.readFile(fp, (err, content) => {
    if (err) { res.writeHead(404); res.end("Not found"); }
    else { res.writeHead(200, { "Content-Type": mt[ext] || "text/plain" }); res.end(content); }
  });
};

// Try ports START_PORT through MAX_PORT until one is free
function tryListen(port) {
  if (port > MAX_PORT) {
    fatal("All ports " + START_PORT + "-" + MAX_PORT + " are in use.\n  Close other instances (check Task Manager) or restart your computer.");
    return;
  }
  const s = http.createServer(requestHandler);
  s.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.log("  Port " + port + " in use, trying " + (port + 1) + "...");
      tryListen(port + 1);
    } else {
      fatal(e.message);
    }
  });
  s.listen(port, () => {
    const url = "http://localhost:" + port;
    console.log("\n  Meeting Simulator running at " + url + "\n  Saves: " + SAVES_DIR + "  |  Ctrl+C to stop\n");
    if (IS_PKG) {
      const { exec } = require("child_process");
      if (process.platform === "win32") exec("start " + url);
      else if (process.platform === "darwin") exec("open " + url);
      else exec("xdg-open " + url);
    }
  });
}

tryListen(START_PORT);
