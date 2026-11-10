import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Le réglage `fleetos.allow_money_override` lève les verrous d'argent (plein validé, facture
 * ou avoir émis) pour une transaction. Il ne doit exister que là où une intervention
 * volontaire est légitime : jamais derrière une route HTTP.
 */

const ROOT = join(__dirname, "..", "..", "..");
const SCANNED = ["server", "shared", "client", "tests", "e2e", "scripts"];
const EXT = /\.(ts|tsx|js|mjs|cjs|sql)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "_archive" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.test(name)) out.push(relative(ROOT, full).split(sep).join("/"));
  }
  return out;
}

const files = SCANNED.flatMap((d) => walk(join(ROOT, d)));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const withText = (needle: RegExp) => files.filter((f) => needle.test(read(f)));

/** Fichiers autorisés à nommer le réglage (les SQL de verrou et `init-database.ts` à venir sont déclarés d'avance). */
const ALLOWED_EXACT = new Set([
  // Preuve en base du trigger des factures : la levée lève le verrou, et seulement pour sa transaction.
  "tests/integration/client-invoices-lock-trigger.test.ts",
  // Preuve en base de l'immutabilité des avoirs et du cumul crédité : la levée explicite les autorise.
  "tests/integration/client-credit-notes.test.ts",
  // Nettoyage des avoirs de test (immuables) sous levée explicite.
  "tests/integration/client-credit-notes-replay.test.ts",
  // Parité migration / init-database des factures : vérifie que le trigger lit bien ce réglage.
  "tests/unit/server/client-invoices-lock-schema.test.ts",
  "server/lib/money-override.ts",
  "tests/support/money-override.ts",
  "scripts/lib/recette-data.ts",
  "server/init-database.ts",
  "server/services/backup-import-service.ts",
  "tests/unit/server/money-override-hygiene.test.ts",
  // Preuve en base du trigger des pleins : la levée lève le verrou, et seulement pour sa transaction.
  "tests/integration/fuel-records-lock-trigger.test.ts",
  // Parité migration / init-database : vérifie que le trigger lit bien ce réglage.
  "tests/unit/server/fuel-records-lock-schema.test.ts",
]);
const ALLOWED_PREFIX = ["server/db/migrations/", "server/db/triggers/"];
const allowed = (f: string) => ALLOWED_EXACT.has(f) || ALLOWED_PREFIX.some((p) => f.startsWith(p));

describe("levée des verrous d'argent : hygiène", () => {
  it("allow_money_override n'apparaît que dans la liste blanche", () => {
    expect(withText(/allow_money_override/).filter((f) => !allowed(f))).toEqual([]);
  });

  it("aucune route HTTP ne peut la lever : ni server/api/** ni server/routes.ts", () => {
    const routes = files.filter((f) => f.startsWith("server/api/") || f === "server/routes.ts");
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((f) => /allow_money_override|withMoneyOverride|money-override/.test(read(f)))).toEqual([]);
  });

  it("la seule route HTTP qui atteint withMoneyOverride est la restauration de sauvegarde (admin)", () => {
    // La garde textuelle ne suit pas les appels : on suit les imports vers le service qui lève le verrou.
    const serverFiles = files.filter((f) => f.startsWith("server/"));
    const importsBackupService = serverFiles.filter(
      (f) => f !== "server/services/backup-import-service.ts" && /backup-import-service/.test(read(f)),
    );
    expect(importsBackupService).toEqual(["server/api/admin-import-backup.routes.ts"]);
    const importsOverride = serverFiles.filter(
      (f) => f !== "server/lib/money-override.ts" && /lib\/money-override|\.\/money-override/.test(read(f)),
    );
    expect(importsOverride).toEqual(["server/services/backup-import-service.ts"]);
    // Et cette route reste réservée à l'administrateur.
    expect(read("server/api/admin-import-backup.routes.ts")).toMatch(/import-backup",\s*authenticate,\s*isAdmin/);
  });

  it("withMoneyOverride n'est importé que par la liste blanche", () => {
    expect(withText(/withMoneyOverride/).filter((f) => !allowed(f))).toEqual([]);
  });

  it("tests, e2e et scripts ne suppriment pleins et factures que par les helpers", () => {
    const direct = /delete\(\s*(?:schema\.)?(?:fuelRecords|clientInvoices)\s*\)|DELETE\s+FROM\s+(?:fuel_records|client_invoices)\b/i;
    const offenders = files
      .filter((f) => /^(tests|e2e|scripts)\//.test(f))
      .filter((f) => f !== "tests/support/money-override.ts" && f !== "tests/unit/server/money-override-hygiene.test.ts")
      // Preuve du trigger : la suppression directe d'un plein validé doit être refusée par la base.
      .filter((f) => f !== "tests/integration/fuel-records-lock-trigger.test.ts")
      // Reset de recette : dans sa transaction, après la levée du verrou (voir le test suivant).
      .filter((f) => f !== "scripts/lib/recette-data.ts")
      // Preuve du trigger : la suppression directe d'une facture émise doit être refusée par la base.
      .filter(
        (f) =>
          f !== "tests/integration/client-invoices-lock-trigger.test.ts" &&
          f !== "tests/contract/client-invoices-lock.contract.test.ts" &&
          // Preuve du trigger des avoirs : suppression directe refusée, nettoyage sous levée.
          f !== "tests/integration/client-credit-notes.test.ts" &&
          f !== "tests/integration/client-credit-notes-replay.test.ts",
      )
      .filter((f) => direct.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("le reset de recette lève le verrou avant ses DELETE", () => {
    const src = read("scripts/lib/recette-data.ts");
    const lift = src.indexOf("allow_money_override");
    expect(lift).toBeGreaterThan(-1);
    expect(src.search(/DELETE FROM (fuel_records|client_invoices)/)).toBeGreaterThan(lift);
  });
});
