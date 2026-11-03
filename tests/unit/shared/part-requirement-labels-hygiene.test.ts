import { describe, expect, it } from "vitest";
import { readRepoFile, readRepoFiles, REPO_SCAN_TIMEOUT_MS, repoFiles } from "../../support/repo-files";
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

const SHARED_FILE = "shared/constants/part-requirements.ts";

const sources = () =>
  readRepoFiles(
    repoFiles({ under: ["client/src", "server", "shared"], match: /\.tsx?$/, skipSegments: ["node_modules", "_archive", "dist"] }),
  );

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

  it("aucune table locale ne lie une clé propre aux demandes de pièce à un texte", async () => {
    // Clés qui n'existent que pour les demandes de pièce. Une valeur « classe CSS » ou
    // « variante de badge » est une présentation, pas un libellé.
    const key = /\b(partially_received|cancel_requested|issued|fulfilled)\s*:\s*(["'`])([^"'`]+)\2/g;
    const presentation = /^(bg-|text-|border-|default$|secondary$|destructive$|outline$)/;
    const offenders: string[] = [];
    for (const [path, text] of await sources()) {
      if (path === SHARED_FILE) continue;
      // Le badge générique est multi-domaines (« issued » = facture émise), AGENTS.md §1.
      if (path === "client/src/components/design-system/status-badge.tsx") continue;
      for (const m of text.matchAll(key)) {
        if (!presentation.test(m[3])) offenders.push(`${path} : ${m[1]}: "${m[3]}"`);
      }
    }
    expect(offenders).toEqual([]);
  }, REPO_SCAN_TIMEOUT_MS);

  it("« Sortie validée » et « Affecté à l'OT » n'existent pas dans le code", async () => {
    const banned = /Sortie validée|Affecté à l['’]OT/;
    const all = await sources();
    expect(all.length).toBeGreaterThan(300);
    const offenders = all.filter(([, text]) => banned.test(text)).map(([path]) => path);
    expect(offenders).toEqual([]);
  }, REPO_SCAN_TIMEOUT_MS);

  it.each([
    "server/services/part-requirements-workflow.ts",
    "client/src/lib/part-requirement-status.ts",
    "client/src/pages/inventory/requests.tsx",
    "client/src/pages/procurement/orders/new.tsx",
  ])("%s importe la source unique des libellés", async (file) => {
    expect(await readRepoFile(file)).toMatch(/@shared\/constants\/part-requirements/);
  });
});
