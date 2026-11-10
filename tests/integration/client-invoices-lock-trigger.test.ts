import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../server/db";
import { CLIENT_INVOICES_ISSUED_LOCK_SQL } from "../../server/init-database";
import { withMoneyOverride } from "../../server/lib/money-override";
import { isCheckViolation, moneyLockMessageOf, pgConstraintOf } from "../../server/lib/pg-errors";
import { clientBillingService } from "../../server/services/client-billing-service";
import { depositInvoice } from "../../server/services/finance-receivables-service";
import { clientInvoices, missions, users } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient, createTestClientInvoice, createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Filet en base du verrou d'argent sur les factures clients (lot V1, PR4) : une facture est émise dès
 * sa création, elle ne se modifie plus et ne se supprime plus, quel que soit l'appelant. Seuls passent
 * la liste blanche (statut, solde, horodatage ; dépôt une seule fois ; auteur du dépôt détaché par la
 * clé étrangère) et la levée explicite par transaction (withMoneyOverride). Annulée = terminal.
 * La traduction HTTP (409 lisible) est couverte par tests/unit/server/money-lock-error.test.ts.
 */
const MIGRATION = "server/db/migrations/20261110_money_lock_invoices_credits.sql";
const CONSTRAINT = "client_invoices_issued_locked";
const ids = createIdBag();
const missionIds: number[] = [];
let clientId = 0;
let otherClientId = 0;
let userId = 0;

async function makeInvoice(values: Partial<typeof clientInvoices.$inferInsert> = {}) {
  const row = await createTestClientInvoice({
    clientId,
    items: [{ description: "Transport TEST", quantity: 1, unitPrice: 100000, total: 100000 }],
    notes: "TEST verrou facture",
    createdBy: userId,
    ...values,
  });
  ids.clientInvoiceIds.push(row.id);
  return row;
}

async function makeMission() {
  const [mission] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("ILOCK"), pickupAddress: "TEST A", deliveryAddress: "TEST B" })
    .returning();
  missionIds.push(mission.id);
  return mission;
}

const invoiceRow = async (id: number) => (await db.select().from(clientInvoices).where(eq(clientInvoices.id, id)))[0];

/** L'appel est refusé par le trigger : 23514, contrainte nommée, message lisible côté serveur. */
async function expectLocked(run: () => Promise<unknown>, label = "écriture") {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught, `${label} acceptée alors qu'elle devait être refusée`).toBeDefined();
  expect(isCheckViolation(caught), label).toBe(true);
  expect(pgConstraintOf(caught), label).toBe(CONSTRAINT);
  expect(moneyLockMessageOf(caught), label).toBeTruthy();
}

async function triggerState() {
  const res = await db.execute(sql`
    SELECT md5(pg_get_functiondef('fn_client_invoices_issued_lock()'::regprocedure)) AS fn,
           (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'client_invoices'::regclass AND tgname = 'trg_client_invoices_issued_lock')::int AS n,
           (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'client_invoices'::regclass AND tgname = 'trg_client_invoices_issued_lock') AS def,
           (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'client_invoices'::regclass AND tgname = 'trg_client_invoices_truncate_lock')::int AS nt,
           (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'client_invoices'::regclass AND tgname = 'trg_client_invoices_truncate_lock') AS deft`);
  return ((res as unknown as { rows: unknown[] }).rows ?? res)[0] as { fn: string; n: number; def: string; nt: number; deft: string | null };
}

beforeAll(async () => {
  await db.execute(sql.raw(CLIENT_INVOICES_ISSUED_LOCK_SQL));
  const user = await createTestUser({ role: "admin" });
  ids.userIds.push(user.id);
  userId = user.id;
  const [client, other] = [await createTestClient(), await createTestClient()];
  ids.clientIds.push(client.id, other.id);
  clientId = client.id;
  otherClientId = other.id;
}, 120_000);

afterAll(async () => {
  await cleanupCreated(ids);
  for (const id of missionIds) await db.delete(missions).where(eq(missions.id, id));
}, 120_000);

describe("trigger client_invoices_issued_locked", { timeout: 60_000 }, () => {
  it("chaque colonne gelée refuse l'UPDATE : montants, lignes, client, mission, numéro, dates, auteur", async () => {
    const mission = await makeMission();
    const invoice = await makeInvoice();
    const id = invoice.id;
    const frozen: [string, ReturnType<typeof sql>][] = [
      ["amount_ht", sql`UPDATE client_invoices SET amount_ht = 1 WHERE id = ${id}`],
      ["vat_rate", sql`UPDATE client_invoices SET vat_rate = 0 WHERE id = ${id}`],
      ["vat_amount", sql`UPDATE client_invoices SET vat_amount = 0 WHERE id = ${id}`],
      ["amount_ttc", sql`UPDATE client_invoices SET amount_ttc = 1 WHERE id = ${id}`],
      ["items", sql`UPDATE client_invoices SET items = '[]'::jsonb WHERE id = ${id}`],
      ["client_id", sql`UPDATE client_invoices SET client_id = ${otherClientId} WHERE id = ${id}`],
      ["client_id NULL", sql`UPDATE client_invoices SET client_id = NULL WHERE id = ${id}`],
      ["mission_id", sql`UPDATE client_invoices SET mission_id = ${mission.id} WHERE id = ${id}`],
      ["invoice_number", sql`UPDATE client_invoices SET invoice_number = ${uniqueTestToken("autre")} WHERE id = ${id}`],
      ["invoice_date", sql`UPDATE client_invoices SET invoice_date = '2026-01-16' WHERE id = ${id}`],
      ["due_date", sql`UPDATE client_invoices SET due_date = '2099-03-01' WHERE id = ${id}`],
      ["notes", sql`UPDATE client_invoices SET notes = 'retouche' WHERE id = ${id}`],
      ["terms_and_conditions", sql`UPDATE client_invoices SET terms_and_conditions = 'autres' WHERE id = ${id}`],
      ["created_by", sql`UPDATE client_invoices SET created_by = NULL WHERE id = ${id}`],
      ["created_at", sql`UPDATE client_invoices SET created_at = now() - interval '1 day' WHERE id = ${id}`],
      ["id", sql`UPDATE client_invoices SET id = id + 1000000000 WHERE id = ${id}`],
    ];
    // Refus indépendants (aucune écriture ne passe) : en parallèle sur le pool, pour ne payer qu'un aller-retour.
    await Promise.all(frozen.map(([label, statement]) => expectLocked(() => db.execute(statement), label)));
    // Même refus par Drizzle, comme le ferait un service.
    await expectLocked(() => db.update(clientInvoices).set({ amountTTC: "1" }).where(eq(clientInvoices.id, id)), "drizzle amountTTC");
    expect(await invoiceRow(id)).toEqual(invoice);
  });

  it("statut, solde et horodatage restent libres", async () => {
    const invoice = await makeInvoice();
    await db.execute(sql`UPDATE client_invoices SET status = 'partial', balance = 1000, updated_at = now() WHERE id = ${invoice.id}`);
    const after = await invoiceRow(invoice.id);
    expect(after.status).toBe("partial");
    expect(after.balance).toBe("1000.00");
  });

  it("solde borné : jamais en hausse (pas de réouverture d'une facture payée), jamais négatif ; baisse jusqu'à 0 acceptée", async () => {
    const invoice = await makeInvoice();
    const id = invoice.id;
    await expectLocked(() => db.execute(sql`UPDATE client_invoices SET balance = balance + 1 WHERE id = ${id}`), "hausse");
    await expectLocked(() => db.execute(sql`UPDATE client_invoices SET balance = -0.01 WHERE id = ${id}`), "négatif");
    await db.execute(sql`UPDATE client_invoices SET status = 'partial', balance = 50000 WHERE id = ${id}`);
    await db.execute(sql`UPDATE client_invoices SET status = 'paid', balance = 0 WHERE id = ${id}`);
    expect(await invoiceRow(id)).toMatchObject({ status: "paid", balance: "0.00" });
    // Réouverture d'une facture payée : le solde remonterait.
    await expectLocked(
      () => db.execute(sql`UPDATE client_invoices SET status = 'pending', balance = amount_ttc WHERE id = ${id}`),
      "réouverture",
    );
    await expectLocked(() => db.execute(sql`UPDATE client_invoices SET balance = 0.01 WHERE id = ${id}`), "hausse après solde");
    expect(await invoiceRow(id)).toMatchObject({ status: "paid", balance: "0.00" });
    // Sous levée explicite (restauration), le solde peut être réécrit.
    await db.transaction(async (tx) => {
      await withMoneyOverride(tx, "test : solde réécrit");
      await tx.execute(sql`UPDATE client_invoices SET balance = 10 WHERE id = ${id}`);
      throw new Error("rollback");
    }).catch((error: Error) => expect(error.message).toBe("rollback"));
  });

  it("paiement exact à la tolérance flottante près : solde rendu jamais négatif, facture payée", async () => {
    // 100 - 100.005 vaut -0.00499999... en flottant : sous la tolérance de 0,005, donc accepté.
    const invoice = await makeInvoice({ amountHT: "100.00", vatAmount: "0.00", amountTTC: "100.00" });
    const result = await clientBillingService.recordPayment(invoice.id, {
      amount: 100.005,
      paymentDate: "2026-01-20",
      paymentMethod: "cash",
      reference: uniqueTestToken("pay"),
      userId,
    });
    expect(result.status).toBe("paid");
    expect(result.newBalance).toBe(0);
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: "paid", balance: "0.00" });
  });

  it("dépôt refusé sur une facture payée ou annulée, y compris annulée dans le même UPDATE", async () => {
    const cancelledNow = await makeInvoice();
    await expectLocked(
      () =>
        db.execute(sql`
          UPDATE client_invoices SET status = 'cancelled', deposited_at = '2026-02-01', deposited_by = ${userId}
          WHERE id = ${cancelledNow.id}`),
      "annulée et déposée d'un coup",
    );
    const paidNow = await makeInvoice();
    await expectLocked(
      () =>
        db.execute(sql`
          UPDATE client_invoices SET status = 'paid', balance = 0, deposited_at = '2026-02-01', deposited_by = ${userId}
          WHERE id = ${paidNow.id}`),
      "payée et déposée d'un coup",
    );
    const paidBefore = await makeInvoice();
    await db.execute(sql`UPDATE client_invoices SET status = 'paid', balance = 0 WHERE id = ${paidBefore.id}`);
    await expectLocked(
      () => db.execute(sql`UPDATE client_invoices SET deposited_at = '2026-02-01', deposited_by = ${userId} WHERE id = ${paidBefore.id}`),
      "déposée après paiement",
    );
    for (const id of [cancelledNow.id, paidNow.id, paidBefore.id]) expect((await invoiceRow(id)).depositedAt).toBeNull();
  });

  it("la suppression est refusée, même d'une facture sans paiement", async () => {
    const invoice = await makeInvoice();
    await expectLocked(() => db.execute(sql`DELETE FROM client_invoices WHERE id = ${invoice.id}`));
    await expectLocked(() => db.delete(clientInvoices).where(eq(clientInvoices.id, invoice.id)), "drizzle delete");
    expect(await invoiceRow(invoice.id)).toBeDefined();
  });

  it("cycle de vie par les services réels : paiement partiel, retard, dépôt une fois, solde", async () => {
    const invoice = await makeInvoice({ invoiceDate: "2026-01-15", dueDate: "2026-02-15" });
    const first = await clientBillingService.recordPayment(invoice.id, {
      amount: 19250,
      paymentDate: "2026-01-20",
      paymentMethod: "bank_transfer",
      reference: uniqueTestToken("pay"),
      userId,
    });
    expect(first.status).toBe("partial");
    expect(await clientBillingService.markOverdueInvoices({ asOf: "2026-03-01", invoiceIds: [invoice.id] })).toEqual([invoice.id]);
    const deposit = await depositInvoice(invoice.id, "2026-03-02", userId, new Date("2026-03-03T12:00:00Z"));
    expect(deposit.changed).toBe(true);
    // Même date rejouée : sans écriture ; autre date : refus du service (409) avant même le trigger.
    expect((await depositInvoice(invoice.id, "2026-03-02", userId, new Date("2026-03-03T12:00:00Z"))).changed).toBe(false);
    await expect(depositInvoice(invoice.id, "2026-03-01", userId, new Date("2026-03-03T12:00:00Z"))).rejects.toMatchObject({ status: 409 });
    const last = await clientBillingService.recordPayment(invoice.id, {
      amount: 100000,
      paymentDate: "2026-03-10",
      paymentMethod: "bank_transfer",
      reference: uniqueTestToken("pay"),
      userId,
    });
    expect(last.status).toBe("paid");
    const after = await invoiceRow(invoice.id);
    expect(after).toMatchObject({ status: "paid", balance: "0.00", depositedAt: "2026-03-02", depositedBy: userId });
    expect(after.amountTTC).toBe(invoice.amountTTC);
  });

  it("dépôt : une seule fois, avec sa date et son auteur ; jamais modifié ni retiré ensuite", async () => {
    const invoice = await makeInvoice();
    const id = invoice.id;
    await expectLocked(() => db.execute(sql`UPDATE client_invoices SET deposited_at = '2026-02-01' WHERE id = ${id}`), "sans auteur");
    await expectLocked(() => db.execute(sql`UPDATE client_invoices SET net_payable = 1 WHERE id = ${id}`), "retenue sans date");
    // Mêmes colonnes que depositInvoice.
    await db.execute(sql`
      UPDATE client_invoices
      SET deposited_at = '2026-02-01', withholding_vat_amount = 19250, withholding_is_amount = 2200,
          net_payable = 97800, deposited_by = ${userId}, updated_at = now()
      WHERE id = ${id}`);
    for (const [label, statement] of [
      ["deposited_at", sql`UPDATE client_invoices SET deposited_at = '2026-02-02' WHERE id = ${id}`],
      ["deposited_at NULL", sql`UPDATE client_invoices SET deposited_at = NULL WHERE id = ${id}`],
      ["withholding_vat_amount", sql`UPDATE client_invoices SET withholding_vat_amount = 0 WHERE id = ${id}`],
      ["withholding_is_amount", sql`UPDATE client_invoices SET withholding_is_amount = 0 WHERE id = ${id}`],
      ["net_payable", sql`UPDATE client_invoices SET net_payable = 1 WHERE id = ${id}`],
      ["deposited_by", sql`UPDATE client_invoices SET deposited_by = NULL WHERE id = ${id}`],
    ] as const) {
      await expectLocked(() => db.execute(statement), label);
    }
    expect(await invoiceRow(id)).toMatchObject({ depositedAt: "2026-02-01", netPayable: "97800.00", depositedBy: userId });
    // Paiement après dépôt : le solde reste libre.
    await db.execute(sql`UPDATE client_invoices SET balance = 0, status = 'paid' WHERE id = ${id}`);
  });

  it("auteur du dépôt supprimé : ON DELETE SET NULL passe, le reste du dépôt reste figé", async () => {
    const depositor = await createTestUser({ role: "secretary" });
    const invoice = await makeInvoice({ createdBy: null });
    await depositInvoice(invoice.id, "2026-02-01", depositor.id, new Date("2026-02-02T12:00:00Z"));
    await db.delete(users).where(eq(users.id, depositor.id));
    const after = await invoiceRow(invoice.id);
    expect(after.depositedBy).toBeNull();
    expect(after.depositedAt).toBe("2026-02-01");
    // Le dépôt n'est pas rouvert pour autant : un nouvel auteur ne se pose plus.
    await expectLocked(() => db.execute(sql`UPDATE client_invoices SET deposited_by = ${userId} WHERE id = ${invoice.id}`));
  });

  it("annulée : statut terminal, ni sortie, ni solde, ni dépôt", async () => {
    const invoice = await makeInvoice();
    await db.execute(sql`UPDATE client_invoices SET status = 'cancelled', updated_at = now() WHERE id = ${invoice.id}`);
    await expectLocked(() => db.execute(sql`UPDATE client_invoices SET status = 'pending' WHERE id = ${invoice.id}`), "sortie");
    await expectLocked(() => db.execute(sql`UPDATE client_invoices SET balance = 0 WHERE id = ${invoice.id}`), "solde");
    await expectLocked(
      () => db.execute(sql`UPDATE client_invoices SET deposited_at = '2026-02-01', deposited_by = ${userId} WHERE id = ${invoice.id}`),
      "dépôt",
    );
    await db.execute(sql`UPDATE client_invoices SET updated_at = now() WHERE id = ${invoice.id}`);
    // Le service refuse déjà le paiement (409) ; la base tient même sans lui.
    await expect(
      clientBillingService.recordPayment(invoice.id, { amount: 1, paymentDate: "2026-02-01", paymentMethod: "cash", userId }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await invoiceRow(invoice.id)).status).toBe("cancelled");
  });

  it("factures sans client ni mission : créées telles quelles, puis gelées comme les autres", async () => {
    const orphan = await makeInvoice({ clientId: null, missionId: null });
    expect(orphan.clientId).toBeNull();
    await expectLocked(() => db.execute(sql`UPDATE client_invoices SET client_id = ${clientId} WHERE id = ${orphan.id}`));
    await db.execute(sql`UPDATE client_invoices SET status = 'paid', balance = 0 WHERE id = ${orphan.id}`);
  });

  it("withMoneyOverride lève le verrou pour sa seule transaction", async () => {
    const invoice = await makeInvoice();
    await db.transaction(async (tx) => {
      await withMoneyOverride(tx, "test du verrou de facture");
      await tx.execute(sql`UPDATE client_invoices SET amount_ttc = 12345 WHERE id = ${invoice.id}`);
    });
    expect((await invoiceRow(invoice.id)).amountTTC).toBe("12345.00");
    await expectLocked(() =>
      db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE client_invoices SET amount_ttc = 1 WHERE id = ${invoice.id}`);
      }),
    );
    // Sur la connexion qui a porté la levée : set_config(..., true) est borné à la transaction.
    await expectLocked(() =>
      db.transaction(async (tx) => {
        await withMoneyOverride(tx, "test du verrou de facture");
        await tx.execute(sql`COMMIT`);
        await tx.execute(sql`BEGIN`);
        await tx.execute(sql`UPDATE client_invoices SET amount_ttc = 2 WHERE id = ${invoice.id}`);
      }),
    );
    expect((await invoiceRow(invoice.id)).amountTTC).toBe("12345.00");
  });

  it("TRUNCATE refusé ; permis sous withMoneyOverride (transaction annulée ensuite)", async () => {
    const kept = await makeInvoice();
    // client_payments vise client_invoices : un TRUNCATE nu est déjà refusé par Postgres, la voie ouverte
    // est CASCADE. Chaque essai tourne dans une transaction toujours annulée : la base partagée n'est
    // jamais vidée, même si le trigger manque.
    const ROLLBACK = new Error("annulation volontaire du test");
    const truncateThenRollback = (override: boolean) =>
      db.transaction(async (tx) => {
        if (override) await withMoneyOverride(tx, "test du verrou de facture");
        await tx.execute(sql`TRUNCATE client_invoices CASCADE`);
        const [{ n }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM client_invoices`)).rows as { n: number }[];
        expect(n).toBe(0);
        throw ROLLBACK;
      });
    await expectLocked(() => truncateThenRollback(false));
    await expect(truncateThenRollback(true)).rejects.toBe(ROLLBACK);
    expect(await invoiceRow(kept.id)).toBeDefined();
  });

  it("verrou de table indisponible : la migration attend 5 s au plus, puis renonce sans erreur", async () => {
    const before = await triggerState();
    const holder = await pool.connect();
    let outcome = "";
    let migration: Promise<unknown> = Promise.resolve();
    try {
      // ROW EXCLUSIVE (une écriture en cours) bloque CREATE TRIGGER (SHARE ROW EXCLUSIVE).
      await holder.query("BEGIN");
      await holder.query("LOCK TABLE client_invoices IN ROW EXCLUSIVE MODE");
      migration = pool.query(readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n"));
      outcome = await Promise.race([
        migration.then(() => "terminée", () => "en erreur"),
        new Promise<string>((resolve) => setTimeout(() => resolve("bloquée"), 15_000)),
      ]);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      await migration.catch(() => undefined);
    }
    expect(outcome).toBe("terminée");
    expect(await triggerState()).toEqual(before);
  });

  it("idempotent : migration et SQL d'init rejoués deux fois, même définition, un seul trigger, aucune donnée touchée", async () => {
    const migration = readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");
    // Base partagée : le décompte porte sur toute la table, l'empreinte sur les seules factures de ce fichier.
    const mine = sql.raw(ids.clientInvoiceIds.join(","));
    const snapshot = sql`SELECT count(*)::int AS n,
      md5(coalesce(string_agg(to_jsonb(i)::text, ',' ORDER BY id) FILTER (WHERE id IN (${mine})), '')) AS h
      FROM client_invoices i`;
    expect(ids.clientInvoiceIds.length).toBeGreaterThan(0);
    const countBefore = await db.execute(snapshot);
    const first = await triggerState();
    expect(first.n).toBe(1);
    expect(first.def).toMatch(/BEFORE DELETE OR UPDATE ON public\.client_invoices FOR EACH ROW/);
    expect(first.nt).toBe(1);
    expect(first.deft).toMatch(/BEFORE TRUNCATE ON public\.client_invoices FOR EACH STATEMENT/);
    for (let i = 0; i < 2; i++) {
      await db.execute(sql.raw(migration));
      await db.execute(sql.raw(CLIENT_INVOICES_ISSUED_LOCK_SQL));
    }
    expect(await triggerState()).toEqual(first);
    expect((await db.execute(snapshot)).rows).toEqual(countBefore.rows);
  });
});
