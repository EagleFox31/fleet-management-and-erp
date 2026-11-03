import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { stripComments } from "../../support/route-guard-scan";

/**
 * Garde-fou (LESSONS_LEARNED, 3 novembre 2026) : la check-list de lancement et le lancement
 * d'une mission jugent les papiers véhicule au même jour d'échéance. Deux fois, la check-list
 * a eu sa propre règle (carte grise ignorée, puis jour local au `<` strict) et annonçait
 * « prêt » une mission que le lancement refusait.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const source = stripComments(readFileSync(join(here, "../../../server/api/missions.routes.ts"), "utf8"));

function body(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `fonction ${name} introuvable`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n}", start);
  return source.slice(start, end);
}

describe("missions.routes.ts : un seul jour d'échéance pour les papiers véhicule", () => {
  it("isDocumentTypeValid ne juge les échéances que par isExpiredOnOrBeforeToday", () => {
    const fn = body("isDocumentTypeValid");
    expect(fn).toContain("isExpiredOnOrBeforeToday(");
    expect(fn).not.toMatch(/isDriverLicenseExpired\(|isDateExpired\(|setHours\(|new Date\(/);
  });

  it("la règle du permis ne s'applique qu'au permis", () => {
    const calls = [...source.matchAll(/isDriverLicenseExpired\(([^)]*)\)/g)].map((m) => m[1].trim());
    const args = calls.filter((arg) => !arg.startsWith("dateValue"));
    expect(args.length).toBeGreaterThan(0);
    for (const arg of args) expect(arg).toMatch(/driverLicenseExpiry/);
  });
});
