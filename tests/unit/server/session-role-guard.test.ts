import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : une décision d'autorisation lit `req.user.role` (relu en base par `authorize` /
 * `isAnyUser` / `isStaff`), jamais `req.session.role`.
 *
 * Le rôle de session est figé à la connexion : un compte rétrogradé ou changé de rôle garde
 * ses anciens droits jusqu'à la déconnexion (ADM2-3, commandes fournisseur ; même défaut
 * retrouvé dans les renouvellements de documents, les missions et le routage WebSocket par
 * rôle de `server/index.ts`).
 *
 * Portée : tout `server/` sauf `server/_archive/` (code mort). Formes reconnues :
 * `session.role`, `session?.role`, `session!.role`, `(req.session as X).role`,
 * `session["role"]` et la déstructuration `{ role } = req.session`.
 *
 * Liste gelée : lectures qui ne décident d'aucun accès. Elle ne peut que diminuer.
 * - "audit" : étiquette d'acteur d'un journal ou d'un événement (`actorRole:`, `role:`).
 * - "write" : écriture du rôle à l'ouverture de session.
 */
type Kind = "audit" | "write";

const FROZEN_EXCEPTIONS: Record<string, Kind[]> = {
  "api/drivers.routes.ts": ["audit"],
  "api/fuel-card.routes.ts": ["audit"],
  "api/vehicles.routes.ts": ["audit"],
  "api/pin-auth.routes.ts": ["write"],
  // Fichier gelé (AGENTS.md §9) : écritures au login et étiquettes d'acteur d'événements.
  "routes.ts": ["audit", "write"],
};

const SERVER_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../server");

const SESSION_ROLE =
  /session\s*(?:\?|!)?\s*\.\s*role\b|session\s+as\s+[^)]+\)\s*(?:\?|!)?\.\s*role\b|session\s*\??\.?\[\s*["'`]role["'`]\s*\]|\{[^}]*\brole\b[^}]*\}\s*=\s*(?:\([^)]*)?req\.session\b/;

const KIND_SHAPE: Record<Kind, RegExp> = {
  // `=(?!=)` : une affectation, jamais une comparaison (`session.role === "admin"` est une décision d'accès).
  audit: /\b(?:actorRole|role)\s*(?::|=(?!=))/,
  write: /session\.role\s*=(?!=)/,
};

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "_archive" || name === "node_modules") continue;
      out.push(...tsFiles(full));
    } else if (name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function sessionRoleReads(): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = [];
  for (const full of tsFiles(SERVER_DIR)) {
    const file = relative(SERVER_DIR, full).split(sep).join("/");
    readFileSync(full, "utf8")
      .split("\n")
      .forEach((text, i) => {
        const t = text.trim();
        if (t.startsWith("//") || t.startsWith("*")) return;
        if (SESSION_ROLE.test(text)) hits.push({ file, line: i + 1, text: t });
      });
  }
  return hits;
}

describe("rôle de session interdit dans les décisions d'autorisation (server/)", () => {
  it("le motif reconnaît les formes de contournement connues", () => {
    for (const sample of [
      "if (req.session?.role !== 'admin')",
      "const r = req.session!.role;",
      "const r = (req.session as any).role;",
      "const r = req.session['role'];",
      "const { role } = req.session;",
    ]) {
      expect(SESSION_ROLE.test(sample), sample).toBe(true);
    }
    expect(SESSION_ROLE.test("const r = req.user.role;")).toBe(false);
  });

  it("aucune lecture de session.role hors de la liste gelée", () => {
    const offenders = sessionRoleReads()
      .filter((h) => !(h.file in FROZEN_EXCEPTIONS))
      .map((h) => `${h.file}:${h.line} ${h.text}`);
    expect(offenders).toEqual([]);
  });

  it("les exceptions gelées restent des étiquettes d'acteur ou l'écriture à la connexion", () => {
    for (const h of sessionRoleReads().filter((x) => x.file in FROZEN_EXCEPTIONS)) {
      const ok = FROZEN_EXCEPTIONS[h.file].some((k) => KIND_SHAPE[k].test(h.text));
      expect(ok, `${h.file}:${h.line} n'est plus une exception légitime : ${h.text}`).toBe(true);
    }
  });

  it("chaque exception gelée est encore utilisée (la liste ne contient rien de périmé)", () => {
    const used = new Set(sessionRoleReads().map((h) => h.file));
    const stale = Object.keys(FROZEN_EXCEPTIONS).filter((f) => !used.has(f));
    expect(stale).toEqual([]);
  });
});
