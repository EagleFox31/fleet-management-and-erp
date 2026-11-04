import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou ALR2 : une alerte est nominative. Toute écriture (lu, suppression)
 * passe par `server/services/alert-inbox-service.ts`, qui filtre sur `user_id`.
 * Les routes d'avant ce lot écrivaient par id seul : n'importe quel compte
 * marquait lue ou supprimait l'alerte d'un autre (même classe que l'incident
 * du 2026-10-30, docs/analysis/LESSONS_LEARNED.md).
 *
 * Liste gelée des autres sites d'écriture : elle ne peut que rétrécir.
 */
const serverDir = fileURLToPath(new URL("../../../server", import.meta.url));

const ALLOWED_WRITERS = new Set([
  "services/alert-inbox-service.ts",
  // Restauration de sauvegarde (admin) : vide toute la table.
  "services/backup-import-service.ts",
  // markAlertAsRead / deleteAlert : plus appelées, voir le test suivant.
  "storage.ts",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === "_archive" || name === "node_modules") return [];
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}

const files = walk(serverDir).map((full) => ({
  path: relative(serverDir, full).replace(/\\/g, "/"),
  source: readFileSync(full, "utf8"),
}));

describe("écritures sur les alertes", () => {
  it("UPDATE / DELETE sur alerts uniquement dans les fichiers autorisés", () => {
    const writers = files
      .filter(({ source }) => /\.(update|delete)\(\s*alerts\s*\)/.test(source))
      .map(({ path }) => path);
    expect(writers.filter((path) => !ALLOWED_WRITERS.has(path))).toEqual([]);
  });

  it("les écritures par id seul de storage ne sont plus appelées", () => {
    const callers = files
      .filter(({ path }) => path !== "storage.ts")
      .filter(({ source }) => /\bstorage\.(markAlertAsRead|deleteAlert)\(/.test(source))
      .map(({ path }) => path);
    expect(callers).toEqual([]);
  });
});
