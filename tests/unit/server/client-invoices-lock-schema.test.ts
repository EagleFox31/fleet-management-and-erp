import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const MIGRATION = "server/db/migrations/20261110_money_lock_invoices.sql";

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
  const marker = "export const CLIENT_INVOICES_ISSUED_LOCK_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("factures émises verrouillées : init-database et migration jumelle", () => {
  it("init-database porte exactement le SQL de la migration, et l'applique au démarrage", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
    expect(readFileSync("server/init-database.ts", "utf8")).toContain("await pool.query(CLIENT_INVOICES_ISSUED_LOCK_SQL);");
  });

  it("le gabarit TypeScript ne transforme pas le SQL : ni interpolation ni échappement", () => {
    const sql = fromInitDatabase();
    expect(sql).not.toContain("${");
    expect(sql).not.toContain("\\");
  });

  it("idempotent, verrou de migration en tête, contrainte nommée, aucune donnée touchée", () => {
    const sql = fromMigration();
    expect(sql.startsWith("SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));\nSET LOCAL lock_timeout = '5s';")).toBe(true);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION fn_client_invoices_issued_lock()");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION fn_client_invoices_truncate_lock()");
    expect(sql).toContain("CREATE OR REPLACE TRIGGER trg_client_invoices_issued_lock\n  BEFORE UPDATE OR DELETE ON client_invoices\n  FOR EACH ROW");
    expect(sql).toContain("CREATE OR REPLACE TRIGGER trg_client_invoices_truncate_lock\n  BEFORE TRUNCATE ON client_invoices\n  FOR EACH STATEMENT");
    // Verrou de table indisponible : refus toléré (WARNING), relu et journalisé par init-database.
    expect(sql).toContain("EXCEPTION WHEN lock_not_available THEN\n  RAISE WARNING");
    expect(readFileSync("server/init-database.ts", "utf8")).toMatch(
      /tgname IN \('trg_client_invoices_issued_lock', 'trg_client_invoices_truncate_lock'\)/,
    );
    expect(sql).not.toMatch(/\bDROP\b/);
    expect(sql).toContain("ERRCODE = 'check_violation', CONSTRAINT = 'client_invoices_issued_locked'");
    expect(sql).not.toMatch(/\bUPDATE client_invoices|\bDELETE FROM|\bINSERT |\bALTER TABLE/);
  });

  it("liste blanche D2 : statut, solde, horodatage et dépôt ; avoirs (PR5) non encore ouverts", () => {
    const sql = fromMigration();
    expect(sql).toContain(
      "free_cols text[] := ARRAY['status', 'balance', 'updated_at',\n" +
        "    'deposited_at', 'withholding_vat_amount', 'withholding_is_amount', 'net_payable', 'deposited_by'];",
    );
    // La colonne des avoirs n'existe pas encore : elle naîtra gelée tant que PR5 ne l'ajoute pas ici.
    expect(sql).not.toMatch(/free_cols text\[\] := ARRAY\[[^\]]*credited_amount_ttc/);
    expect(sql).not.toMatch(/(NEW|OLD)\.credited_amount_ttc/);
    expect(sql).toContain("current_setting('fleetos.allow_money_override', true) = 'on'");
    // Annulée : terminal.
    expect(sql).toContain("IF OLD.status = 'cancelled'\n     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.balance IS DISTINCT FROM OLD.balance) THEN");
    // deposited_by vers NULL : seulement par l'action de clé étrangère (UPDATE lancé depuis un trigger).
    expect(sql).toContain("IF NEW.deposited_by IS NULL AND OLD.deposited_by IS NOT NULL AND pg_trigger_depth() > 1");
    // Dépôt : ni sur une facture annulée ou payée, même dans le même UPDATE.
    expect(sql).toContain(
      "IF OLD.deposited_at IS NOT NULL OR OLD.status = 'cancelled' OR NEW.status = 'cancelled'\n" +
        "       OR OLD.status = 'paid' OR NEW.status = 'paid'",
    );
    // Solde : en baisse seulement, jamais négatif.
    expect(sql).toContain("IF NEW.balance IS DISTINCT FROM OLD.balance AND (NEW.balance > OLD.balance OR NEW.balance < 0) THEN");
  });

  it("le message 409 de la contrainte existe et parle métier", () => {
    const src = readFileSync("server/lib/pg-errors.ts", "utf8");
    expect(src).toMatch(/client_invoices_issued_locked: "Cette facture est émise : [^"]+"/);
  });
});
