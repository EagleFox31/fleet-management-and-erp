import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import * as roles from "../../../shared/constants/roles";
import {
  COVERED_ELSEWHERE,
  EXCLUSIONS,
  MAX_EXCLUSIONS,
  missingFromSweep,
  signatureOf,
  SWEEP_ROUTES,
} from "../../support/client-scope-sweep-table";
import { scanClientOpenParamRoutes } from "../../support/route-guard-scan";

/**
 * Garde du balayage de cloison client (AGENTS.md §11) : toute route `isAnyUser` dont le chemin porte
 * un parametre doit figurer au balayage (`client-scope-sweep.contract.test.ts`), etre balayee par un
 * autre contrat nomme, ou figurer aux exclusions avec sa raison. Sinon une route ouverte a un client
 * peut repondre autrement pour l'objet d'un autre et pour un identifiant absent sans que rien ne le voie.
 *
 * Limite : seule la garde ecrite dans l'en-tete de la route est vue (pas une garde posee au montage).
 */
const root = fileURLToPath(new URL("../../..", import.meta.url));
const serverDir = `${root}server`;

describe("balayage de cloison : aucune route ouverte a un client ne manque", () => {
  const found = scanClientOpenParamRoutes(serverDir, roles as never);

  it("le scan voit les routes ouvertes (sinon il ne garde rien)", () => {
    expect(found.length).toBeGreaterThan(15);
    expect(found).toContain("GET /api/work-orders/:p");
  });

  it("chaque route ouverte est au balayage, couverte ailleurs ou exclue", () => {
    expect(missingFromSweep(found)).toEqual([]);
  });

  it("une route fictive absente de la table est signalee", () => {
    expect(missingFromSweep([...found, "GET /api/fictive/:p"])).toEqual(["GET /api/fictive/:p"]);
    expect(missingFromSweep([...found, "DELETE /api/work-orders/:p"])).toEqual(["DELETE /api/work-orders/:p"]);
  });

  it("les exclusions portent une raison et ne peuvent que rétrécir", () => {
    // Plafond en dur ici (et non importe) : relever MAX_EXCLUSIONS ne doit pas suffire a faire passer le test.
    expect(EXCLUSIONS.length).toBeLessThanOrEqual(1);
    expect(MAX_EXCLUSIONS).toBe(1);
    for (const e of EXCLUSIONS) expect(e.raison.length, signatureOf(e)).toBeGreaterThan(30);
  });

  it("une route couverte ailleurs figure bien dans le contrat nomme", () => {
    for (const c of COVERED_ELSEWHERE) {
      expect(existsSync(`${root}${c.file}`), c.file).toBe(true);
      expect(readFileSync(`${root}${c.file}`, "utf8"), signatureOf(c)).toContain(c.fragment);
    }
  });

  it("une route ne figure pas deux fois dans les listes", () => {
    const all = [...SWEEP_ROUTES, ...COVERED_ELSEWHERE, ...EXCLUSIONS].map((r) => `${signatureOf(r)}`);
    expect(all.length).toBe(new Set(all).size);
  });
});
