import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { PART_REQUIREMENT_STATUS_LABELS } from "../../../shared/constants/part-requirements";

/**
 * PRT5 : un libellé de statut de demande de pièce vit à un seul endroit,
 * `shared/constants/part-requirements.ts` (AGENTS.md §1). Il en existait trois, elles avaient
 * divergé (`fulfilled` valait « Installée » côté client et « Utilisée » côté serveur).
 *
 * Garde-fous :
 * 1. la chaîne affichée est celle de la règle (« Entrée en stock » / « Sortie du stock ») ;
 * 2. aucune table locale ne lie une clé propre aux demandes de pièce à un texte français ;
 * 3. deux libellés interdits n'existent nulle part dans le code ;
 * 4. les consommateurs nommés par AGENTS.md importent bien la source unique.
 */

const root = fileURLToPath(new URL("../../..", import.meta.url));
const SHARED_FILE = join("shared", "constants", "part-requirements.ts");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (["node_modules", "_archive", "dist"].includes(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(path) ? [path] : [];
  });
}

const files = ["client/src", "server", "shared"].flatMap((d) => sources(join(root, d)));
const rel = (p: string) => relative(root, p).replace(/\\/g, "/");
const read = (p: string) => readFileSync(p, "utf8");

describe("PRT5 : libellés de statut des demandes de pièce", () => {
  it("la chaîne complète suit la règle de AGENTS.md §1", () => {
    const L = PART_REQUIREMENT_STATUS_LABELS;
    expect([L.pending, L.approved, L.ordered, L.received, L.issued]).toEqual([
      "En attente",
      "Approuvée",
      "Commandée",
      "Entrée en stock",
      "Sortie du stock",
    ]);
    expect(L.fulfilled).toBe("Utilisée");
  });

  it("aucune table locale ne lie une clé propre aux demandes de pièce à un texte", () => {
    // Clés qui n'existent que pour les demandes de pièce. Une valeur « classe CSS » ou
    // « variante de badge » est une présentation, pas un libellé.
    const key = /\b(partially_received|cancel_requested|issued|fulfilled)\s*:\s*(["'`])([^"'`]+)\2/g;
    const presentation = /^(bg-|text-|border-|default$|secondary$|destructive$|outline$)/;
    const offenders: string[] = [];
    for (const file of files) {
      const path = rel(file);
      if (path === SHARED_FILE.replace(/\\/g, "/")) continue;
      // Le badge générique est multi-domaines (« issued » = facture émise), AGENTS.md §1.
      if (path === "client/src/components/design-system/status-badge.tsx") continue;
      for (const m of read(file).matchAll(key)) {
        if (!presentation.test(m[3])) offenders.push(`${path} : ${m[1]}: "${m[3]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("« Sortie validée » et « Affecté à l'OT » n'existent pas dans le code", () => {
    const banned = /Sortie validée|Affecté à l['’]OT/;
    const offenders = files.filter((f) => banned.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it.each([
    "server/services/part-requirements-workflow.ts",
    "client/src/lib/part-requirement-status.ts",
    "client/src/pages/inventory/requests.tsx",
    "client/src/pages/procurement/orders/new.tsx",
  ])("%s importe la source unique des libellés", (file) => {
    expect(read(join(root, file))).toMatch(/@shared\/constants\/part-requirements/);
  });
});
