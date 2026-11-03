import fs from "node:fs";
import path from "node:path";

/** Scanner des routes d'écriture sans garde de rôle déclarée (voir tests/unit/server/write-route-guards.test.ts). */
export const API_DIR = path.resolve(process.cwd(), "server/api");
export const WRITE_ROUTE = /\b(router|\w+Router)\.(post|put|patch|delete)\(\s*(["'`])([^"'`]+)\3([^\n]*)/g;
const ROUTE_GUARD = /authorize\(|\bis[A-Z]\w*\b/;

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

export function findUnguardedWriteRoutes(): string[] {
  const found: string[] = [];
  for (const file of listFiles(API_DIR)) {
    const source = fs.readFileSync(file, "utf8");
    const rel = path.relative(API_DIR, file).split(path.sep).join("/");
    for (const match of source.matchAll(WRITE_ROUTE)) {
      // Seuls les middlewares déclarés avant le handler comptent.
      const declaration = match[5].split(/async\s*\(|\(req\b/)[0];
      if (ROUTE_GUARD.test(declaration)) continue;
      found.push(`${rel} ${match[2].toUpperCase()} ${match[4]}`);
    }
  }
  return found.sort();
}
