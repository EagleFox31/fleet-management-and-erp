import { describe, expect, it } from "vitest";
import { readRepoFiles, REPO_SCAN_TIMEOUT_MS, repoFiles } from "../../support/repo-files";

/**
 * Garde-fou (LESSONS_LEARNED, 4 novembre 2026) : passer `fuel_records` à la suppression douce
 * (`deleted_at`) oblige chaque lecteur à filtrer. Un lecteur oublié (storage.ts, un fichier SQL,
 * une route de statistiques) fait réapparaître un plein supprimé dans les totaux.
 *
 * Tout `.from(fuelRecords)`, `innerJoin/leftJoin(fuelRecords` et tout `FROM|JOIN fuel_records`
 * sous server/ doit citer `deletedAt` / `deleted_at` dans l'instruction (fenêtre de 25 lignes,
 * l'appel pouvant s'écrire sur plusieurs lignes), sauf exceptions gelées ci-dessous.
 */
const WINDOW_LINES = 25;
// Les conditions sont parfois construites avant la requête (tableau `conditions`).
const LOOKBACK_LINES = 20;

const READ = () =>
  /\.from\(\s*fuelRecords\s*\)|(?:innerJoin|leftJoin|rightJoin)\(\s*fuelRecords\b|\b(?:FROM|JOIN)\s+fuel_records\b/gi;

/** Exceptions légitimes, justifiées une par une (fichier -> raison). Liste gelée. */
const FROZEN_EXCEPTIONS: Record<string, string> = {
  "server/services/export-service.ts": "sauvegarde complète : exporte aussi les lignes supprimées pour pouvoir restaurer",
  "server/services/vehicle-deletion-service.ts": "inventaire des dépendances d'un véhicule avant suppression : compte toutes les lignes, supprimées comprises",
  "server/services/vehicle-deletion-service-simple.ts": "idem (variante), code mort conservé hors usage",
  "server/api/missions.routes.ts": "recherche de rejeu par request_key : la clé reste portée par la ligne supprimée, testée ensuite sur record.deletedAt (409)",
  "server/init-database.ts": "DDL et migrations, pas une lecture métier",
  "server/seed-data.ts": "données d'amorçage, pas une lecture métier",
};

/** Positions (ligne 1-based) des lectures de fuel_records, appels multi-lignes compris (regex sur le texte entier). */
function readsIn(text: string): number[] {
  return [...text.matchAll(READ())].map((m) => text.slice(0, m.index).split("\n").length);
}

function offendersIn(file: string, text: string): string[] {
  const unified = text.replace(/\r\n/g, "\n");
  const lines = unified.split("\n");
  return readsIn(unified)
    .filter((line) => !/deletedAt|deleted_at/.test(lines.slice(Math.max(0, line - 1 - LOOKBACK_LINES), line - 1 + WINDOW_LINES).join("\n")))
    .map((line) => `${file}:${line}`);
}

describe("hygiène : tout lecteur de fuel_records filtre deleted_at", () => {
  it("aucune lecture sans filtre hors exceptions gelées", async () => {
    const files = repoFiles({ under: ["server"], match: /\.ts$/, skipSegments: ["_archive"] });
    expect(files.length).toBeGreaterThan(50);
    const sources = await readRepoFiles(files);
    const offenders = sources
      .filter(([file]) => !(file.split("\\").join("/") in FROZEN_EXCEPTIONS))
      .flatMap(([file, text]) => offendersIn(file, text));
    expect(offenders).toEqual([]);
  }, REPO_SCAN_TIMEOUT_MS);

  it("le fichier SQL de trigger et storage.ts filtrent aussi", async () => {
    const sources = await readRepoFiles(["server/storage.ts", "server/db/triggers/mission-fuel-triggers.sql", "server/db/triggers/fuel-alerts-triggers.sql"]);
    for (const [file, text] of sources) {
      expect(readsIn(text.split("\r").join("")).length, file).toBeGreaterThan(0);
      expect(offendersIn(file, text), file).toEqual([]);
    }
  });

  it("le détecteur voit un appel écrit sur plusieurs lignes", () => {
    expect(offendersIn("x.ts", "await db\n  .select()\n  .from(\n    fuelRecords\n  )\n  .where(eq(fuelRecords.id, 1));")).toEqual(["x.ts:3"]);
    expect(offendersIn("x.ts", "db.select().from(fuelRecords)\n.where(and(eq(a, b),\n isNull(fuelRecords.deletedAt)))")).toEqual([]);
    expect(offendersIn("y.sql", "SELECT 1\nFROM fuel_records fr\nWHERE fr.id = 1")).toEqual(["y.sql:2"]);
  });
});
