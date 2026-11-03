import { describe, expect, it } from "vitest";
import { readRepoFiles, REPO_SCAN_TIMEOUT_MS, repoFiles } from "../../support/repo-files";

/**
 * Garde-fou (LESSONS_LEARNED, 3 novembre 2026) : `storage.getVehicles()` pagine à 10
 * par défaut. Appelée sans argument pour « tout le parc », elle tronquait en silence
 * les pleins, les statistiques carburant, l'historique de consommation, les
 * statistiques technicien et trois contrôles d'alertes dès le 11e véhicule.
 *
 * Tout le parc : `storage.listAllVehicles()`. Une page : passer `limit` explicitement.
 */
describe("hygiène : pas de getVehicles() sans pagination explicite", () => {
  it("aucun appel à getVehicles() sans argument côté serveur", async () => {
    const files = repoFiles({ under: ["server"], match: /\.ts$/, skipSegments: ["_archive"] });
    expect(files.length).toBeGreaterThan(50);

    const offenders = (await readRepoFiles(files)).flatMap(([file, text]) =>
      text
        .split(/\r?\n/)
        .flatMap((line, index) => (/\bgetVehicles\(\s*\)/.test(line) ? [`${file}:${index + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  }, REPO_SCAN_TIMEOUT_MS);
});
