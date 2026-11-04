import { describe, expect, it } from "vitest";
import { readRepoFile, repoFiles, REPO_SCAN_TIMEOUT_MS } from "../../support/repo-files";

/**
 * DOC1 : un centre désactivé n'est pas proposé dans le sélecteur de centre du renouvellement.
 *
 * Aucun filtre n'existe côté écran : le sélecteur affiche tel quel ce que
 * `GET /api/document-renewals/centers` renvoie, et c'est l'API qui retire les centres
 * inactifs (contrat : `tests/contract/document-renewal-centers.contract.test.ts`).
 * Ce test garde donc la seule chose qui puisse faire réapparaître un centre inactif
 * dans le choix : un sélecteur qui demanderait `includeInactive` à l'API.
 */
// Seul sélecteur : le dialogue de renouvellement rapide de vehicle-documents.tsx, jamais ouvert, a été retiré
// (le bouton mène au parcours /vehicles/documents/renew).
const SELECTORS = [
  "client/src/pages/vehicles/document-renew.tsx",
];
const CENTERS_URL = "/api/document-renewals/centers";

describe("DOC1 : sélecteur de centre de renouvellement", { timeout: REPO_SCAN_TIMEOUT_MS }, () => {
  it.each(SELECTORS)("%s lit la liste des choix sans demander les centres inactifs", async (file) => {
    const source = await readRepoFile(file);
    const urls = source.match(/`\/api\/document-renewals\/centers[^`]*`/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).not.toContain("includeInactive");
    expect(source).toContain(CENTERS_URL);
  });

  it("aucun fichier du client n'utilise includeInactive pour les centres (pas d'écran qui l'ouvrirait au sélecteur)", async () => {
    const offenders: string[] = [];
    for (const file of repoFiles({ under: ["client/src"], match: /\.(ts|tsx)$/ })) {
      const source = await readRepoFile(file);
      if (source.includes(CENTERS_URL) && source.includes("includeInactive")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
