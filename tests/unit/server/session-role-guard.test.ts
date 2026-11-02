import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : une décision d'autorisation lit `req.user.role` (relu en base par `authorize` /
 * `isAnyUser` / `isStaff`), jamais `req.session.role`.
 *
 * Le rôle de session est figé à la connexion : un compte rétrogradé ou changé de rôle garde
 * ses anciens droits jusqu'à la déconnexion (ADM2-3, commandes fournisseur ; même défaut
 * retrouvé dans les renouvellements de documents et les missions).
 *
 * Liste gelée : lectures qui ne décident d'aucun accès. Elle ne peut que diminuer.
 */
const FROZEN_EXCEPTIONS: Record<string, string> = {
  // Étiquette d'audit (acteur journalisé), aucune décision d'accès.
  "drivers.routes.ts": "actorRole d'audit",
  "fuel-card.routes.ts": "actorRole d'audit",
  "operations.routes.ts": "actorRole d'audit",
  "vehicles.routes.ts": "actorRole d'audit",
  "warehouse.routes.ts": "actorRole d'audit",
  // Écriture du rôle à l'ouverture de la session PIN, pas une lecture.
  "pin-auth.routes.ts": "écriture à la connexion",
};

const API_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../server/api");

function sessionRoleReads(): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = [];
  for (const file of readdirSync(API_DIR).filter((f) => f.endsWith(".ts"))) {
    readFileSync(join(API_DIR, file), "utf8")
      .split("\n")
      .forEach((text, i) => {
        if (/session\??\.role\b/.test(text) && !text.trim().startsWith("//")) {
          hits.push({ file, line: i + 1, text: text.trim() });
        }
      });
  }
  return hits;
}

describe("rôle de session interdit dans les décisions d'autorisation (server/api)", () => {
  it("aucune lecture de session.role hors de la liste gelée", () => {
    const offenders = sessionRoleReads()
      .filter((h) => !(h.file in FROZEN_EXCEPTIONS))
      .map((h) => `${h.file}:${h.line} ${h.text}`);
    expect(offenders).toEqual([]);
  });

  it("les exceptions gelées restent des étiquettes d'audit ou l'écriture à la connexion", () => {
    for (const h of sessionRoleReads().filter((x) => x.file in FROZEN_EXCEPTIONS)) {
      const label = FROZEN_EXCEPTIONS[h.file];
      const ok = label === "écriture à la connexion"
        ? /session\.role\s*=/.test(h.text)
        : /actorRole\s*:/.test(h.text);
      expect(ok, `${h.file}:${h.line} n'est plus une exception légitime : ${h.text}`).toBe(true);
    }
  });

  it("chaque exception gelée est encore utilisée (la liste ne contient rien de périmé)", () => {
    const used = new Set(sessionRoleReads().map((h) => h.file));
    const stale = Object.keys(FROZEN_EXCEPTIONS).filter((f) => !used.has(f));
    expect(stale).toEqual([]);
  });
});
