import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Handlers et méthodes de stockage qui écrivent un compte (PIN, mot de passe, e-mail) : pas de `console.*`.
 * Le masquage pino (redact) ne couvre pas `console` : une erreur SQL y sortirait avec `detail`
 * (« Failing row contains (…) »). Liste gelée vide : tout nouveau `console.*` ici fait échouer le test.
 */

const routes = readFileSync("server/routes.ts", "utf8");
const storage = readFileSync("server/storage.ts", "utf8");
const backup = readFileSync("server/services/backup-import-service.ts", "utf8");

function slice(src: string, start: string, endPattern: RegExp): string {
  const i = src.indexOf(start);
  expect(i, `${start} introuvable`).toBeGreaterThan(-1);
  const rest = src.slice(i + start.length);
  const m = endPattern.exec(rest);
  return rest.slice(0, m ? m.index : rest.length);
}

const ROUTES: Array<[string, string]> = [
  ["register", 'app.post("/api/auth/register"'],
  ["POST users", 'app.post("/api/users"'],
  ["PATCH users", 'app.patch("/api/users/:id"'],
  ["DELETE users", 'app.delete("/api/users/:id"'],
];
const STORAGE = ["createUser", "updateUser", "deleteUser"];

describe("écriture de comptes : journal structuré seulement", () => {
  it.each(ROUTES)("route %s", (_name, marker) => {
    expect(slice(routes, marker, /\n {2}app\./)).not.toMatch(/console\./);
  });
  it.each(STORAGE)("storage.%s", (name) => {
    expect(slice(storage, `  async ${name}(`, /\n {2}(?:async |\n)/)).not.toMatch(/console\./);
  });
  it("import de sauvegarde : PIN clair haché avant insertion, aucun console", () => {
    expect(backup).not.toMatch(/console\./);
    expect(backup).toContain("PIN_BCRYPT_COST");
  });
});
