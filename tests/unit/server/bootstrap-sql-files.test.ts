import { existsSync, readdirSync, readFileSync } from "fs";
import { describe, expect, it } from "vitest";

/**
 * Un fichier SQL de trigger ou de fonction n'agit que s'il est appliqué au démarrage
 * (`BOOTSTRAP_SQL_FILES` de `server/init-database.ts`). Un fichier présent mais non appliqué
 * passe pour une protection en place alors qu'il n'existe pas en base (cas de
 * `vehicle-activation-triggers.sql`, supprimé le 5 novembre 2026).
 *
 * Liste gelée : fichiers non appliqués, avec la raison. Elle ne doit que décroître.
 */
const NOT_BOOTSTRAPPED_FROZEN: Record<string, string> = {
  "work-orders-alerts-triggers.sql": "alertes OT ; garde suppress_side_effects testée (cdc-schema-drift), installation au démarrage à décider",
  "vehicle-alerts-triggers.sql": "alertes véhicule ; garde suppress_side_effects testée (cdc-schema-drift), installation au démarrage à décider",
  "maintenance-schedules-alerts-triggers.sql":
    "alertes maintenance ; garde suppress_side_effects testée (cdc-schema-drift), installation au démarrage à décider",
  "vehicle-tires-alerts-triggers.sql": "alertes pneus ; aucune référence, installation ou suppression à décider",
};

const SQL_DIRS = ["server/db/triggers", "server/db/functions"];

function bootstrapFiles(): string[] {
  const src = readFileSync("server/init-database.ts", "utf8");
  const block = src.match(/BOOTSTRAP_SQL_FILES = \[([\s\S]*?)\]/);
  expect(block, "BOOTSTRAP_SQL_FILES introuvable dans server/init-database.ts").not.toBeNull();
  return [...block![1].matchAll(/['"]([^'"]+\.sql)['"]/g)].map((m) => m[1]);
}

function sqlFiles(): string[] {
  return SQL_DIRS.filter((dir) => existsSync(dir)).flatMap((dir) =>
    readdirSync(dir).filter((f) => f.endsWith(".sql")),
  );
}

describe("fichiers SQL de triggers : appliqués au démarrage ou gelés avec leur raison", () => {
  it("chaque .sql est dans BOOTSTRAP_SQL_FILES ou dans la liste gelée", () => {
    const applied = new Set(bootstrapFiles());
    const orphans = sqlFiles().filter((f) => !applied.has(f) && !(f in NOT_BOOTSTRAPPED_FROZEN));
    expect(orphans, "ajouter le fichier à BOOTSTRAP_SQL_FILES, ou le supprimer s'il est mort").toEqual([]);
  });

  it("chaque entrée de BOOTSTRAP_SQL_FILES existe", () => {
    const present = new Set(sqlFiles());
    expect(bootstrapFiles().filter((f) => !present.has(f))).toEqual([]);
  });

  it("la liste gelée ne garde que des fichiers présents et non appliqués", () => {
    const present = new Set(sqlFiles());
    const applied = new Set(bootstrapFiles());
    const stale = Object.keys(NOT_BOOTSTRAPPED_FROZEN).filter((f) => !present.has(f) || applied.has(f));
    expect(stale, "retirer ces entrées de NOT_BOOTSTRAPPED_FROZEN").toEqual([]);
  });
});
