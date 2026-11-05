import { readFileSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { bodyIdSchema, idSchema, MAX_DB_INTEGER_ID } from "../../../shared/contracts/common";
import { sourceFiles } from "../../support/route-guard-scan";

/**
 * Id lu dans la query ou le corps par un schéma Zod : borné à l'int4 (`idSchema` pour la query,
 * `bodyIdSchema` pour un corps JSON, `shared/contracts/common.ts`). Le filet `routeIdRangeGuard`
 * ne lit que le chemin : sans borne, `?vehicleId=2147483648` atteint la base (22003) et répond 500.
 *
 * Cliquet sur `server/api` et `shared/contracts` : une propriété dont le nom désigne un id
 * (`id`, `…Id`, `…Ids`, `…edBy`) déclarée par `z.number()` ou `z.coerce.number()` sans `.max(`.
 * Les schémas de réponse sont comptés aussi : les borner ne coûte rien et garde la règle simple.
 * Limites : un id déclaré par un schéma intermédiaire (`const x = z.number(); { vehicleId: x }`)
 * ou sous un nom hors motif (`owner`, `client`) n'est pas vu.
 */

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const ID_NAME = /^(?:ids?|\w*Ids?|\w+edBy)$/;
const LOOSE_NUMBER = /\bz\.(?:coerce\.)?number\(/;

/**
 * Relevé du 5 novembre 2026 : uniquement des schémas de réponse (aucune valeur reçue du client).
 * Ne peut que rétrécir.
 */
const FROZEN: Record<string, number> = {
  "shared/contracts/audit-logs.ts": 2,
  "shared/contracts/auth-lockout.ts": 2,
  "shared/contracts/backups.ts": 1,
  "shared/contracts/common.ts": 1,
  "shared/contracts/document-renewal-centers.ts": 1,
  "shared/contracts/fuel-anomalies.ts": 5,
  "shared/contracts/fuel-prices.ts": 1,
  "shared/contracts/fuel-vouchers.ts": 4,
  "shared/contracts/incidents.ts": 4,
  "shared/contracts/kpi.ts": 1,
  "shared/contracts/part-requirement-receive.ts": 1,
  "shared/contracts/part-scans.ts": 3,
  "shared/contracts/pending-invoices.ts": 1,
  "shared/contracts/quality-check.ts": 1,
  "shared/contracts/time-tracking.ts": 2,
  "shared/contracts/tire-movements.ts": 2,
  "shared/contracts/vehicle-cost-summary.ts": 1,
  "shared/contracts/work-order-booking.ts": 1,
  "shared/contracts/workshop-labor-rates.ts": 2,
};

function countUnboundedIdFields(source: string, fileName = "x.ts"): number {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "";
      const init = node.initializer.getText(sf).replace(/\s+/g, "");
      if (ID_NAME.test(name) && LOOSE_NUMBER.test(init) && !init.includes(".max(")) count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

function actualCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const dir of ["server/api", "shared/contracts"]) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      const n = countUnboundedIdFields(readFileSync(file, "utf8"), file);
      if (n > 0) counts[relative(ROOT, file).replace(/\\/g, "/")] = n;
    }
  }
  return counts;
}

describe("ids Zod bornés à l'int4 (query et corps)", () => {
  it("idSchema et bodyIdSchema refusent la première valeur hors int4", () => {
    expect(idSchema.safeParse(String(MAX_DB_INTEGER_ID)).success).toBe(true);
    expect(idSchema.safeParse(String(MAX_DB_INTEGER_ID + 1)).success).toBe(false);
    expect(bodyIdSchema.safeParse(MAX_DB_INTEGER_ID).success).toBe(true);
    expect(bodyIdSchema.safeParse(MAX_DB_INTEGER_ID + 1).success).toBe(false);
    expect(bodyIdSchema.safeParse("12").success).toBe(false);
  });

  it("le détecteur voit les formes lâches et ignore les formes bornées", () => {
    const src = `const s = z.object({
      vehicleId: z.number().int().positive(),
      supplierIds: z.array(z.coerce.number()),
      createdBy: z
        .number()
        .int(),
      tireId: z.coerce.number().int().positive().max(2147483647),
      clientId: z.coerce.number({ invalid_type_error: "x" }).int(),
      userId: bodyIdSchema,
      quantity: z.number(),
      sortBy: z.number(),
    });`;
    expect(countUnboundedIdFields(src)).toBe(4);
  });

  it("server/api et shared/contracts : aucun nouvel id Zod non borné", () => {
    expect(actualCounts()).toEqual(FROZEN);
  });
});
