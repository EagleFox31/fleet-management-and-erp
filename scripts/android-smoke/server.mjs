// Serveur témoin du test de fumée APK (job `smoke` de build-android-apk.yml).
// Sert, à l'origine chargée par l'APK (CAP_SERVER_URL), une page sonde et le VRAI service
// worker de l'application (client/public/sw.js). En ligne, la sonde vérifie le bridge natif,
// /api et le cookie en même origine, /ws, la prise de contrôle du service worker, et écrit une
// donnée dans IndexedDB. Relancée serveur coupé, elle affiche ce qu'elle lit encore.
// Usage : node scripts/android-smoke/server.mjs <port> <fichier-rapport>
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { WebSocketServer } from "ws";

const port = Number(process.argv[2] ?? 8080);
const reportPath = process.argv[3] ?? "android-smoke-report.json";
const COOKIE = "fleetos_smoke=1";
const serviceWorker = readFileSync(new URL("../../client/public/sw.js", import.meta.url));

const probe = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sonde FleetOS Tech</title></head>
<body><h1 id="status">Sonde en cours</h1><p id="detail"></p>
<script>
const show = (status, detail) => {
  document.getElementById("status").textContent = status;
  document.getElementById("detail").textContent = detail || "";
};
const idb = (mode, fn) => new Promise((resolve, reject) => {
  const open = indexedDB.open("fleetos-smoke", 1);
  open.onupgradeneeded = () => open.result.createObjectStore("kv");
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction("kv", mode);
    const req = fn(tx.objectStore("kv"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  };
});
const controlled = () => new Promise((resolve) => {
  if (navigator.serviceWorker.controller) return resolve(true);
  const timer = setTimeout(() => resolve(false), 20000);
  navigator.serviceWorker.addEventListener("controllerchange", () => { clearTimeout(timer); resolve(true); });
});
(async () => {
  const cap = window.Capacitor;
  const native = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  let online = false;
  try { online = (await fetch("/api/smoke/ping", { credentials: "same-origin" })).ok; } catch {}

  if (!online) {
    // Relance serveur coupé : la page n'a pu venir que du cache du service worker.
    let saved = null;
    try { saved = await idb("readonly", (s) => s.get("visite")); } catch {}
    const sw = !!navigator.serviceWorker.controller;
    show("SONDE-HORS-LIGNE", "sw=" + (sw ? "oui" : "non") + " idb=" + (saved ? "oui" : "non") + " bridge=" + (native ? "oui" : "non"));
    return;
  }

  const report = { native, platform: cap && cap.getPlatform ? cap.getPlatform() : null, origin: location.origin, ping: true };
  report.ws = await new Promise((resolve) => {
    try {
      const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
      const timer = setTimeout(() => resolve(false), 10000);
      ws.onmessage = (m) => { clearTimeout(timer); ws.close(); resolve(m.data === "pong"); };
      ws.onopen = () => ws.send("ping");
      ws.onerror = () => { clearTimeout(timer); resolve(false); };
    } catch { resolve(false); }
  });
  try {
    await navigator.serviceWorker.register("/sw.js");
    report.swControlled = await controlled();
  } catch (e) { report.swControlled = false; report.swError = String(e); }
  try {
    await idb("readwrite", (s) => s.put(new Date().toISOString(), "visite"));
    report.idbWritten = true;
  } catch (e) { report.idbWritten = false; report.idbError = String(e); }
  await fetch("/api/smoke/report", {
    method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json" }, body: JSON.stringify(report),
  });
  show("SONDE-EN-LIGNE", JSON.stringify(report));
})();
</script></body></html>`;

// Coque précachée par sw.js (STATIC_ASSETS) : chaque entrée doit répondre 200, sinon l'installation échoue.
const shell = {
  "/manifest.json": ["application/manifest+json", '{"name":"Sonde FleetOS Tech"}'],
  "/favicon.jpg": ["image/jpeg", Buffer.alloc(0)],
  "/logo.jpg": ["image/jpeg", Buffer.alloc(0)],
};

const server = createServer((req, res) => {
  console.log(`${req.method} ${req.url} accept=${req.headers.accept ?? "-"} cookie=${req.headers.cookie ?? "-"}`);
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": `${COOKIE}; Path=/; HttpOnly; SameSite=Lax` });
    return res.end(probe);
  }
  if (req.method === "GET" && req.url === "/sw.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
    return res.end(serviceWorker);
  }
  if (req.method === "GET" && req.url in shell) {
    const [type, body] = shell[req.url];
    res.writeHead(200, { "content-type": type });
    return res.end(body);
  }
  if (req.method === "GET" && req.url === "/api/smoke/ping") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.method === "POST" && req.url === "/api/smoke/report") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const report = { ...JSON.parse(body || "{}"), cookieSeen: (req.headers.cookie ?? "").includes(COOKIE) };
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log("rapport :", JSON.stringify(report));
      res.writeHead(204).end();
    });
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (socket) => socket.on("message", (m) => socket.send(String(m) === "ping" ? "pong" : "?")));

server.listen(port, "127.0.0.1", () => console.log(`serveur témoin sur 127.0.0.1:${port}`));
