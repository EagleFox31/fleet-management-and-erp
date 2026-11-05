import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { stripComments } from "../../support/route-guard-scan";

/**
 * Garde-fou (#224, LESSONS_LEARNED 3 novembre 2026) : une échéance de document se juge par
 * `shared/constants/expiry-day.ts` (jour UTC, valable le jour J, expiré à J+1), jamais par
 * un calcul local. Trois recopies locales de la règle ont déjà divergé (check-list, alertes,
 * liste `expiredDocuments`).
 *
 * Un fichier qui parle d'échéance (`expiryDate`, `*Expiry`, `technicalInspectionDate`) ne doit
 * contenir ni comparaison directe `new Date(<échéance>) < ...`, ni `setHours(0`, ni division
 * par la durée d'un jour. Liste gelée : dette connue, qui ne peut que rétrécir.
 */

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const SCANNED = ["server", "client/src", "shared"];
const SKIPPED = /(^|\/)(_archive|node_modules)(\/|$)|vehicle-activation-service-|vehicle-deletion-service-/;

const EXPIRY_FIELD = /\b(expiryDate|\w*Expiry|technicalInspectionDate)\b/;
const DIRECT_COMPARE = /new Date\([^)]*\b(expiryDate|\w*Expiry|technicalInspectionDate)\b[^)]*\)(\.getTime\(\))?\s*[<>]/;
const LOCAL_DAY = /setHours\(0|\/\s*86_?400_?000\b|\(1000 \* 60 \* 60 \* 24\)/;

/** Dette connue au 3 novembre 2026 (affichages client et CPC). À retirer quand le fichier est corrigé. */
const FROZEN = new Set<string>([
  "client/src/components/dashboard/expiring-docs-alert.tsx",
  "client/src/components/vehicles/document-expiry-panel.tsx",
  "client/src/components/vehicles/vehicle-documents.tsx",
  "client/src/components/vehicles/vehicle-health-score.tsx",
  "client/src/pages/vehicles/document-renew.tsx",
]);

/** Fichiers dont le calcul local porte sur autre chose qu'une échéance de document (entretien). */
const NOT_DOCUMENT_EXPIRY = new Set<string>([
  "server/api/vehicles.routes.ts",
  "server/services/alert-service.ts",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const rel = relative(root, full).replace(/\\/g, "/");
    if (SKIPPED.test(rel)) return [];
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });
}

function offenders(): string[] {
  return SCANNED.flatMap((d) => walk(join(root, d)))
    .filter((rel) => {
      const src = stripComments(readFileSync(join(root, rel), "utf8"));
      if (!EXPIRY_FIELD.test(src)) return false;
      if (DIRECT_COMPARE.test(src)) return true;
      return !NOT_DOCUMENT_EXPIRY.has(rel) && LOCAL_DAY.test(src);
    })
    .sort();
}

describe("échéances : pas de calcul de jour local hors expiry-day.ts", () => {
  const found = offenders();

  it("aucun nouveau fichier ne recopie la règle du jour d'échéance", () => {
    expect(found.filter((f) => !FROZEN.has(f))).toEqual([]);
  });

  it("la liste gelée ne garde que des fichiers encore fautifs", () => {
    expect([...FROZEN].filter((f) => !found.includes(f))).toEqual([]);
  });

  it("les fichiers exclus (entretien) ne comparent pas directement une échéance de document", () => {
    for (const rel of NOT_DOCUMENT_EXPIRY) {
      expect(DIRECT_COMPARE.test(stripComments(readFileSync(join(root, rel), "utf8"))), rel).toBe(false);
    }
  });
});
