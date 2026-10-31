import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou (LESSONS_LEARNED, 31 octobre 2026, « Heure de fin de verrou décalée »).
 *
 * `users.locked_until` et `users.last_failed_login_at` sont des `timestamp` sans
 * fuseau. Le store pg (`DbLockoutStore`) les écrit et les relit avec le même pilote,
 * donc dans le même fuseau ; Drizzle, lui, les relit comme de l'UTC : une heure de
 * décalage sur un serveur en UTC+1. Tant que la colonne n'est pas passée en
 * `timestamptz` (migration prévue, lot base de données), ces deux colonnes ne se
 * lisent que par le store.
 *
 * Contrôle : tout fichier de `server/` ou `shared/` qui nomme ces colonnes (en SQL ou
 * en propriété Drizzle) doit figurer dans la liste ci-dessous, avec sa raison ; et
 * aucun fichier, hors déclaration du schéma, ne référence la colonne Drizzle
 * `users.lockedUntil` / `users.lastFailedLoginAt`.
 *
 * Angle mort : une requête Drizzle qui sélectionne toute la ligne `users` et la renvoie
 * telle quelle (sans nommer ces champs) n'est pas détectée.
 */
const ALLOWED: Record<string, string> = {
  "shared/schema.ts": "déclaration des colonnes",
  "server/init-database.ts": "création idempotente des colonnes (DDL)",
  "server/services/login-lockout-db-store.ts": "le store pg : seul lecteur et écrivain",
  "server/services/login-lockout-service.ts": "LockState calculé à partir du store",
  "server/middleware/login-lockout-guard.ts": "LockState lu par le store",
  "server/api/auth-lockout.routes.ts": "lignes de DbLockoutStore.listLocked",
  "server/lib/app-error.ts": "commentaire (corps du 429)",
  "shared/contracts/auth-lockout.ts": "contrat HTTP (chaîne ISO)",
};

const COLUMN_NAME = /\b(lockedUntil|lastFailedLoginAt|locked_until|last_failed_login_at)\b/;
const DRIZZLE_COLUMN = /\busers\s*\.\s*(lockedUntil|lastFailedLoginAt)\b/;

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "_archive") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Fichiers fautifs : noms de colonne hors liste, ou colonne Drizzle lue hors schéma. */
function violations(files: { path: string; text: string }[]): string[] {
  const bad: string[] = [];
  for (const { path, text } of files) {
    if (COLUMN_NAME.test(text) && !(path in ALLOWED)) bad.push(`${path} : nomme une colonne de verrou hors du store`);
    if (path !== "shared/schema.ts" && DRIZZLE_COLUMN.test(text)) bad.push(`${path} : lit la colonne par Drizzle`);
  }
  return bad;
}

describe("colonnes de verrou lues par le seul store pg", () => {
  it("aucun fichier serveur ne lit locked_until / last_failed_login_at hors du store", () => {
    const files = ["server", "shared"].flatMap((d) =>
      sourceFiles(join(ROOT, d)).map((f) => ({
        path: relative(ROOT, f).replace(/\\/g, "/"),
        text: readFileSync(f, "utf8"),
      })),
    );
    expect(files.length).toBeGreaterThan(50);
    expect(violations(files)).toEqual([]);
  });

  it("contre-épreuve : une lecture Drizzle ou un nouveau lecteur est détecté", () => {
    expect(
      violations([{ path: "server/api/foo.routes.ts", text: "db.select({ u: users.lockedUntil }).from(users)" }]),
    ).toHaveLength(2);
    expect(
      violations([{ path: "server/api/auth-lockout.routes.ts", text: "where(gt(users.lastFailedLoginAt, now))" }]),
    ).toEqual(["server/api/auth-lockout.routes.ts : lit la colonne par Drizzle"]);
    expect(violations([{ path: "server/x.ts", text: "SELECT locked_until FROM users" }])).toHaveLength(1);
  });

  it("chaque exception de la liste existe encore", () => {
    for (const path of Object.keys(ALLOWED)) expect(statSync(join(ROOT, path)).isFile()).toBe(true);
  });
});
