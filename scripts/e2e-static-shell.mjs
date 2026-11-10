// Serveur statique du build de production, pour les e2e qui n'ont besoin que de la coquille
// (service worker, précache) : aucun serveur d'application, aucune base de données.
//
//   node scripts/e2e-static-shell.mjs [port]      # sert dist/public (après `vite build`)
//
// Toute route non fichier renvoie index.html (comme le serveur complet) ; /api/* répond 401 JSON,
// donc l'application se retrouve sur l'écran de connexion, jamais connectée.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "dist/public");
const port = Number(process.argv[2] || process.env.PORT || 5099);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp4": "video/mp4",
};

if (!existsSync(path.join(root, "index.html"))) {
  console.error("dist/public/index.html absent : lancer `vite build` d'abord");
  process.exit(1);
}

createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    // Pourcentage mal formé (%E0%A4%A) : requête invalide, pas une exception du serveur.
    res.writeHead(400).end();
    return;
  }
  if (/^\/api(\/|$)/i.test(pathname.replace(/\/{2,}/g, "/"))) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "Non authentifié", code: "UNAUTHENTICATED" }));
    return;
  }
  let file = path.join(root, path.normalize(pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  const isFile = existsSync(file) && statSync(file).isFile();
  if (!isFile) file = path.join(root, "index.html");
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file)] || "application/octet-stream",
    "cache-control": file.endsWith("index.html") || file.endsWith("sw.js") ? "no-cache" : "public, max-age=31536000",
  });
  res.end(readFileSync(file));
}).listen(port, "127.0.0.1", () => console.log(`coquille statique sur http://127.0.0.1:${port}`));
