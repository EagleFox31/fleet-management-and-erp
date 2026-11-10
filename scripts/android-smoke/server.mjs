// Serveur témoin du test de fumée APK (job `smoke` de build-android-apk.yml).
// Sert une page sonde à l'origine chargée par l'APK (CAP_SERVER_URL) et écrit ce que la
// WebView a pu faire : bridge natif injecté, /api et cookie de session en même origine, /ws.
// Usage : node scripts/android-smoke/server.mjs <port> <fichier-rapport>
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { WebSocketServer } from "ws";

const port = Number(process.argv[2] ?? 8080);
const reportPath = process.argv[3] ?? "android-smoke-report.json";
const COOKIE = "fleetos_smoke=1";

const probe = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sonde FleetOS Tech</title></head>
<body><h1 id="status">Sonde en cours</h1>
<script>
(async () => {
  const cap = window.Capacitor;
  const report = {
    native: !!(cap && cap.isNativePlatform && cap.isNativePlatform()),
    platform: cap && cap.getPlatform ? cap.getPlatform() : null,
    origin: location.origin,
  };
  try {
    const r = await fetch("/api/smoke/ping", { credentials: "same-origin" });
    report.ping = r.ok;
  } catch (e) { report.ping = false; report.pingError = String(e); }
  report.ws = await new Promise((resolve) => {
    try {
      const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
      const timer = setTimeout(() => resolve(false), 10000);
      ws.onmessage = (m) => { clearTimeout(timer); ws.close(); resolve(m.data === "pong"); };
      ws.onopen = () => ws.send("ping");
      ws.onerror = () => { clearTimeout(timer); resolve(false); };
    } catch { resolve(false); }
  });
  await fetch("/api/smoke/report", {
    method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json" }, body: JSON.stringify(report),
  });
  document.getElementById("status").textContent = "Sonde terminée";
})();
</script></body></html>`;

const server = createServer((req, res) => {
  console.log(`${req.method} ${req.url} cookie=${req.headers.cookie ?? "-"}`);
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": `${COOKIE}; Path=/; HttpOnly; SameSite=Lax` });
    return res.end(probe);
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
