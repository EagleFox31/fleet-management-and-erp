import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const MIGRATION = "server/db/migrations/20261105_users_keep_active_admin.sql";

function fromMigration(): string {
  return norm(
    norm(readFileSync(MIGRATION, "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n"),
  );
}

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
function fromInitDatabase(): string {
  const src = norm(readFileSync("server/init-database.ts", "utf8"));
  const marker = "export const USERS_KEEP_ACTIVE_ADMIN_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("users : au moins un administrateur actif, init-database et migration jumelle", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
  });

  it("le gabarit TypeScript ne transforme pas le SQL : ni interpolation ni échappement", () => {
    const sql = fromInitDatabase();
    expect(sql).not.toContain("${");
    expect(sql).not.toContain("\\");
  });

  it("idempotent, verrou de migration en tête, contrainte nommée, aucune donnée touchée", () => {
    const sql = fromMigration();
    expect(sql.startsWith("SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));")).toBe(true);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION fn_users_keep_active_admin()");
    expect(sql).toContain("CREATE OR REPLACE TRIGGER trg_users_keep_active_admin");
    expect(sql).not.toMatch(/DROP TRIGGER/);
    expect(sql).toContain("CONSTRAINT = 'users_keep_one_active_admin'");
    expect(sql).toContain("ERRCODE = 'check_violation'");
    expect(sql).not.toMatch(/\bUPDATE users|\bDELETE FROM|\bINSERT /);
  });

  it("clé de verrou distincte de celle de la garde de route (fleetmaster_last_admin) : pas d'attente croisée", () => {
    const sql = fromMigration();
    // La garde de route tient son verrou (session) pendant l'écriture, sur une autre connexion : même clé = attente sans fin.
    expect(sql).toContain("hashtext('fleetmaster_last_active_admin')");
    expect(sql).not.toContain("hashtext('fleetmaster_last_admin')");
    // Même définition d'« actif » que la garde : rôle admin et compte non supprimé.
    expect(sql).toContain("u.role = 'admin' AND u.deleted_at IS NULL");
    expect(sql).toContain("FOR SHARE;");
    expect(sql).not.toContain("NOT EXISTS");
  });
});
