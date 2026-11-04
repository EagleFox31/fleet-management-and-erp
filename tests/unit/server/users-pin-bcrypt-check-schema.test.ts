import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { users } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const MIGRATION = "server/db/migrations/20261104_users_pin_bcrypt_check.sql";
const NAME = "users_pin_bcrypt_check";
const PREFIX = "^[$]2[aby][$]";

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
  const marker = "export const USERS_PIN_BCRYPT_CHECK_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("users.pin : CHECK bcrypt, init-database et migration jumelle", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
  });

  it("le gabarit TypeScript ne transforme pas le SQL : ni interpolation ni échappement", () => {
    const sql = fromInitDatabase();
    expect(sql).not.toContain("${");
    expect(sql).not.toContain("\\");
  });

  it("le préfixe accepte les hash bcrypt et refuse un PIN en clair (même regex qu'en SQL)", () => {
    const re = new RegExp(PREFIX);
    for (const hash of ["$2a$10$abc", "$2b$04$abc", "$2y$12$abc"]) expect(re.test(hash), hash).toBe(true);
    for (const plain of ["1234", "0000", "$2x$10$abc", "2b$10$", "$2", " $2b$10$abc"]) expect(re.test(plain), plain).toBe(false);
  });

  it("CHECK posée NOT VALID si absente, validée dans un sous-bloc qui piège la seule violation", () => {
    const sql = fromMigration();
    const blocks = sql.split("DO $$").slice(1).map((b) => b.replace(/\s+/g, " "));
    expect(blocks).toHaveLength(1);
    const [block] = blocks;
    expect(block).toMatch(/IF NOT EXISTS \( SELECT 1 FROM pg_constraint WHERE conrelid = 'users'::regclass AND conname = 'users_pin_bcrypt_check' \) THEN/);
    expect(block).toContain(`ADD CONSTRAINT ${NAME} CHECK (pin IS NULL OR pin ~ '${PREFIX}') NOT VALID;`);
    expect(block).toMatch(/BEGIN ALTER TABLE users VALIDATE CONSTRAINT users_pin_bcrypt_check; EXCEPTION WHEN check_violation THEN/);
    expect(block.match(/check_violation/g)).toHaveLength(1);
    expect(block).toMatch(/lock_not_available/);
    expect(block.match(/RAISE WARNING '([^']*)'/g)!.every((w) => w.includes(NAME))).toBe(true);
    // Aucune donnée touchée ni rien retiré.
    expect(sql).not.toMatch(/UPDATE |DELETE |DROP |NOT NULL|DEFAULT/);
  });

  it("lock_timeout posé dans la transaction, avant tout ALTER TABLE", () => {
    const sql = fromMigration();
    const timeout = sql.indexOf("SET LOCAL lock_timeout = '5s';");
    expect(timeout).toBeGreaterThan(sql.indexOf("pg_advisory_xact_lock"));
    expect(timeout).toBeLessThan(sql.indexOf("ALTER TABLE"));
  });

  it("même nom et même préfixe que Drizzle", () => {
    const { checks } = getTableConfig(users);
    const check = checks.find((c) => c.name === NAME);
    expect(check).toBeDefined();
    const chunks = (check!.value as unknown as { queryChunks: unknown[] }).queryChunks;
    const text = chunks.map((c) => (typeof c === "object" && c && "value" in c ? (c as { value: string[] }).value.join("") : "")).join("");
    expect(text).toContain(`~ '${PREFIX}'`);
  });

  it("init-database applique le SQL puis relit l'écart, après les migrations rejouées", () => {
    const src = norm(readFileSync("server/init-database.ts", "utf8"));
    expect(src).toMatch(/await pool\.query\(USERS_PIN_BCRYPT_CHECK_SQL\);\n\s*await reportUsersPinBcryptGaps\(pool\);/);
    const posed = src.indexOf("await pool.query(USERS_PIN_BCRYPT_CHECK_SQL)");
    // La migration jumelle est aussi rejouée par applyMigrationSqlFiles : la reprise des PIN en clair passe
    // avant les deux, sinon le VALIDATE du premier démarrage voit encore du clair et reste NOT VALID.
    const migrations = src.indexOf("await applyMigrationSqlFiles();");
    const reprise = src.indexOf("await hashPlainUserPins(pool);");
    expect(reprise).toBeGreaterThan(-1);
    expect(reprise).toBeLessThan(migrations);
    expect(migrations).toBeLessThan(posed);
  });

  it("la reprise ne touche que le clair : un préfixe $2 non conforme est compté, jamais réécrit", () => {
    const src = norm(readFileSync("server/lib/pin-hash-migration.ts", "utf8"));
    expect(src).toContain("pin IS NOT NULL AND pin !~ '^[$]2'");
    expect(src).toContain(`pin ~ '^[$]2' AND pin !~ '${PREFIX}'`);
  });
});
