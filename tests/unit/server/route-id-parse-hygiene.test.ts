import { readFileSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { MAX_DB_INTEGER_ID, parseRouteId } from "../../../server/lib/route-id";
import { sourceFiles, stripComments } from "../../support/route-guard-scan";

/**
 * Identifiant de route : une seule lecture, `parseRouteId` (`server/lib/route-id.ts`).
 *
 * `parseInt("12abc")` vaut 12 : la route vise alors un autre objet que celui demandé
 * (justificatif de règlement, coûts de mission, 5 novembre 2026). `Number(req.params.x)`
 * accepte `"1e3"`, `" 7 "` ou `"0x1F"`, et un id au-delà de l'int4 fait répondre 500 par Postgres.
 *
 * Cliquet : le nombre de `parseInt(req.params…` / `Number(req.params…` par fichier de
 * `server/api` ne peut que baisser. Un fichier absent de la liste n'en a aucun. Quand un
 * fichier passe à `parseRouteId`, baisser (ou retirer) son entrée : le test l'exige.
 *
 * Limite : une valeur d'abord déstructurée (`const { id } = req.params; parseInt(id)`)
 * n'est pas vue ; `server/routes.ts`, gelé, n'est pas couvert.
 */

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const API_DIR = join(ROOT, "server/api");
const LOOSE_PARAM_READ = /\b(?:Number\.)?parseInt\(\s*req\.params\b|\bNumber\(\s*req\.params\b/g;

/** Occurrences relevées le 5 novembre 2026. Ne peut que rétrécir. */
const FROZEN: Record<string, number> = {
  "admin-users-guard.routes.ts": 1,
  "document-renewals.routes.ts": 1,
  "drivers-management.routes.ts": 1,
  "drivers.routes.ts": 2,
  "fuel-card.routes.ts": 2,
  "part-requirements.routes.ts": 3,
  "parts-catalog.routes.ts": 3,
  "supplier-invoices.routes.ts": 5,
  "suppliers.routes.ts": 8,
  "vehicles.routes.ts": 2,
  "work-order-items.routes.ts": 4,
  "work-order-parts.routes.ts": 5,
};

export function countLooseParamReads(source: string): number {
  return (stripComments(source).match(LOOSE_PARAM_READ) ?? []).length;
}

function actualCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of sourceFiles(API_DIR)) {
    const n = countLooseParamReads(readFileSync(file, "utf8"));
    if (n > 0) counts[relative(API_DIR, file).replace(/\\/g, "/")] = n;
  }
  return counts;
}

describe("lecture des ids de route : parseRouteId, cliquet sur parseInt/Number(req.params)", () => {
  it("aucune lecture lâche nouvelle, et la liste gelée suit les retraits", () => {
    expect(actualCounts()).toEqual(FROZEN);
  });

  it("le motif voit les formes lâches, pas parseRouteId ni un commentaire", () => {
    expect(countLooseParamReads("const a = parseInt(req.params.id);")).toBe(1);
    expect(countLooseParamReads("const a = Number.parseInt(req.params.id, 10);")).toBe(1);
    expect(countLooseParamReads("const a = Number( req.params.assignmentId);")).toBe(1);
    expect(countLooseParamReads("const a = parseRouteId(req.params.id, m);")).toBe(0);
    expect(countLooseParamReads("// parseInt(req.params.id)\nconst a = 1;")).toBe(0);
  });

  it("parseRouteId : chiffres seuls, de 1 à l'int4, sinon 400", () => {
    expect(parseRouteId("12", "m")).toBe(12);
    expect(parseRouteId(String(MAX_DB_INTEGER_ID), "m")).toBe(MAX_DB_INTEGER_ID);
    for (const bad of ["12abc", "0", "-1", "1.5", "1e3", " 7", "0x1F", "", String(MAX_DB_INTEGER_ID + 1), undefined, 12]) {
      expect(() => parseRouteId(bad, "Identifiant invalide.")).toThrowError(
        expect.objectContaining({ status: 400, message: "Identifiant invalide." }),
      );
    }
  });
});
