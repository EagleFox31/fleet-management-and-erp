import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paidTtcOf, statusAfterBalanceChange } from "../../../shared/constants/client-invoices";
import { createClientCreditNoteSchema } from "../../../shared/contracts/client-credit-notes";
import { CREDIT_NOTE_WRITER_ROLES, CLIENT_BILLING_EVENT_ROLES } from "../../../shared/constants/roles";
import { creditNoteAmounts } from "../../../server/lib/credit-note-amounts";
import { CREDIT_NOTE_NUMBER_SPEC, INVOICE_NUMBER_SPEC, dailyNumberDateOf } from "../../../server/lib/daily-document-number";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const DIR = "server/db/migrations";
const TABLE_MIGRATION = `${DIR}/20261110_client_credit_notes.sql`;
const LOCK_MIGRATION = `${DIR}/20261110_money_lock_invoices.sql`;
const CREDITS_MIGRATION = `${DIR}/20261110_money_lock_invoices_credits.sql`;

const body = (path: string) =>
  norm(norm(readFileSync(path, "utf8")).split("\n").filter((l) => !l.startsWith("--")).join("\n"));

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
function initSql(name: string): string {
  const src = norm(readFileSync("server/init-database.ts", "utf8"));
  const marker = `export const ${name} = \``;
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("avoirs : init-database et migrations jumelles", () => {
  it("init-database porte exactement le SQL de la table d'avoirs et l'applique au démarrage", () => {
    expect(initSql("CLIENT_CREDIT_NOTES_SQL")).toBe(body(TABLE_MIGRATION));
    expect(readFileSync("server/init-database.ts", "utf8")).toContain("await pool.query(CLIENT_CREDIT_NOTES_SQL);");
  });

  it("le verrou des factures d'init-database est celui de la migration d'avoirs, pas celui de PR4", () => {
    expect(initSql("CLIENT_INVOICES_ISSUED_LOCK_SQL")).toBe(body(CREDITS_MIGRATION));
    expect(body(LOCK_MIGRATION)).not.toBe(body(CREDITS_MIGRATION));
  });

  it("rejeu dans les deux ordres : la migration qui porte la règle des avoirs est la dernière à s'appliquer", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    const at = (f: string) => files.indexOf(f);
    expect(at("20261110_money_lock_invoices_credits.sql")).toBeGreaterThan(at("20261110_money_lock_invoices.sql"));
    expect(at("20261110_money_lock_invoices_credits.sql")).toBeGreaterThan(at("20261110_client_credit_notes.sql"));
    const redefiners = files.filter((f) => /CREATE OR REPLACE FUNCTION fn_client_invoices_issued_lock/.test(readFileSync(`${DIR}/${f}`, "utf8")));
    expect(redefiners.sort().pop()).toBe("20261110_money_lock_invoices_credits.sql");
  });

  it("table : contraintes nommées, FK RESTRICT, immuable, idempotente, sans DROP", () => {
    const sql = body(TABLE_MIGRATION);
    for (const c of [
      "client_credit_notes_amount_ht_positive",
      "client_credit_notes_ttc_sum",
      "client_credit_notes_reason_not_blank",
    ]) {
      expect(sql).toContain(c);
    }
    expect(sql).toContain("REFERENCES client_invoices(id) ON DELETE RESTRICT");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS client_credit_notes");
    expect(sql).toContain("request_key");
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON client_credit_notes");
    expect(sql).toContain("BEFORE TRUNCATE ON client_credit_notes");
    expect(sql).toContain("CONSTRAINT = 'client_credit_notes_immutable'");
    expect(sql).not.toMatch(/\bDROP\b/);
  });

  it("règle d'avoir sur la facture : colonne libre, contrainte nommée", () => {
    const sql = body(CREDITS_MIGRATION);
    expect(sql).toContain("'credited_amount_ttc'");
    expect(sql).toContain("CONSTRAINT = 'client_invoices_issued_locked'");
  });

  it("le schéma Drizzle déclare la colonne et la table", () => {
    const schema = readFileSync("shared/schema.ts", "utf8");
    expect(schema).toContain('numeric("credited_amount_ttc"');
    expect(schema).toContain('pgTable("client_credit_notes"');
  });
});

describe("avoirs : calculs et contrat", () => {
  it("TVA en centimes depuis le taux de la facture, TTC = HT + TVA", () => {
    expect(creditNoteAmounts(100000, "19.25")).toEqual({ htCents: 10000000, vatCents: 1925000, ttcCents: 11925000 });
    expect(creditNoteAmounts(100, "0")).toEqual({ htCents: 10000, vatCents: 0, ttcCents: 10000 });
    expect(creditNoteAmounts(0.01, "19.25")).toEqual({ htCents: 1, vatCents: 0, ttcCents: 1 });
    expect(creditNoteAmounts(10.1, null).ttcCents).toBe(1010);
  });

  it("statut après avoir : soldé = payé, retard conservé, sous le TTC = partiel", () => {
    expect(statusAfterBalanceChange("pending", 0, 1000)).toBe("paid");
    expect(statusAfterBalanceChange("overdue", 0, 1000)).toBe("paid");
    expect(statusAfterBalanceChange("overdue", 400, 1000)).toBe("overdue");
    expect(statusAfterBalanceChange("pending", 400, 1000)).toBe("partial");
    expect(statusAfterBalanceChange("pending", 1000, 1000)).toBe("pending");
  });

  it("payé = TTC - avoirs - solde (un avoir n'est pas un paiement)", () => {
    expect(paidTtcOf({ amountTTC: "1000.00", creditedAmountTtc: "0", balance: "400.00" })).toBe(600);
    expect(paidTtcOf({ amountTTC: "1000.00", creditedAmountTtc: "300.00", balance: "700.00" })).toBe(0);
    expect(paidTtcOf({ amountTTC: "1000.00", creditedAmountTtc: "300.00", balance: "100.00" })).toBe(600);
    expect(paidTtcOf({ amountTTC: "1000.00", creditedAmountTtc: undefined, balance: "0.00" })).toBe(1000);
  });

  it("contrat : motif de 3 à 500 caractères, montant positif, clé obligatoire", () => {
    const ok = { amountHt: "1500,5", reason: "Remise commerciale", requestKey: "cle-test-0001" };
    expect(createClientCreditNoteSchema.parse(ok).amountHt).toBe(1500.5);
    for (const bad of [
      { ...ok, reason: "ab" },
      { ...ok, reason: "x".repeat(501) },
      { ...ok, reason: "   " },
      { ...ok, amountHt: 0 },
      { ...ok, amountHt: -5 },
      { ...ok, amountHt: "1.234" },
      { ...ok, requestKey: "" },
      { reason: ok.reason, requestKey: ok.requestKey },
    ]) {
      expect(createClientCreditNoteSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("rôles : écriture admin et comptable, lecture limitée à la facturation (aucun client)", () => {
    expect([...CREDIT_NOTE_WRITER_ROLES]).toEqual(["admin", "accountant"]);
    expect(CLIENT_BILLING_EVENT_ROLES).not.toContain("client");
    for (const role of CREDIT_NOTE_WRITER_ROLES) expect(CLIENT_BILLING_EVENT_ROLES).toContain(role);
  });
});

describe("numérotation journalière partagée", () => {
  it("les factures gardent FACT, verrou invoice, table client_invoices (comportement historique)", () => {
    expect(INVOICE_NUMBER_SPEC).toEqual({ prefix: "FACT", table: "client_invoices", column: "invoice_number", lockScope: "invoice" });
    expect(CREDIT_NOTE_NUMBER_SPEC).toEqual({ prefix: "AV", table: "client_credit_notes", column: "credit_note_number", lockScope: "credit-note" });
  });

  it("date du jour en UTC, AAAAMMJJ", () => {
    expect(dailyNumberDateOf(new Date("2026-11-10T23:59:59Z"))).toBe("20261110");
  });

  it("generateInvoiceNumberInTransaction délègue au service partagé", () => {
    const src = readFileSync("server/services/client-billing-service.ts", "utf8");
    expect(src).toContain("nextDailyNumber(tx, INVOICE_NUMBER_SPEC)");
  });
});
