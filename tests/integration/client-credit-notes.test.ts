import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { CLIENT_CREDIT_NOTES_SQL, CLIENT_INVOICES_ISSUED_LOCK_SQL } from "../../server/init-database";
import { withMoneyOverride } from "../../server/lib/money-override";
import { isCheckViolation, moneyLockMessageOf, pgConstraintOf } from "../../server/lib/pg-errors";
import { createCreditNote } from "../../server/services/client-credit-note-service";
import { clientCreditNotes, clientInvoices } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient, createTestClientInvoice, createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Filet en base des avoirs (lot V1, PR5) : l'avoir est immuable (UPDATE, DELETE, TRUNCATE refusés, levée par
 * withMoneyOverride seulement), le cumul crédité d'une facture ne fait que monter et ne dépasse jamais le TTC.
 * Service : deux avoirs simultanés (un seul passe), rejeu par request_key.
 */
const ids = createIdBag();
let userId = 0;
let clientId = 0;
const noteIds: number[] = [];

async function makeInvoice(values: Partial<typeof clientInvoices.$inferInsert> = {}) {
  const row = await createTestClientInvoice({
    clientId,
    amountHT: "100000.00",
    vatRate: "0",
    vatAmount: "0.00",
    amountTTC: "100000.00",
    balance: "100000.00",
    createdBy: userId,
    notes: "TEST avoir",
    ...values,
  });
  ids.clientInvoiceIds.push(row.id);
  return row;
}

const invoiceRow = async (id: number) => (await db.select().from(clientInvoices).where(eq(clientInvoices.id, id)))[0];
const key = () => uniqueTestToken("avkey");

async function expectRefused(run: () => Promise<unknown>, constraint: string, label: string) {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught, `${label} acceptée alors qu'elle devait être refusée`).toBeDefined();
  expect(isCheckViolation(caught), label).toBe(true);
  expect(pgConstraintOf(caught), label).toBe(constraint);
  expect(moneyLockMessageOf(caught), label).toBeTruthy();
}

beforeAll(async () => {
  await db.execute(sql.raw(CLIENT_CREDIT_NOTES_SQL));
  await db.execute(sql.raw(CLIENT_INVOICES_ISSUED_LOCK_SQL));
  const user = await createTestUser({ role: "accountant" });
  ids.userIds.push(user.id);
  userId = user.id;
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  clientId = client.id;
}, 120_000);

afterAll(async () => {
  await db.transaction(async (tx) => {
    await withMoneyOverride(tx, "nettoyage de données de test");
    for (const id of ids.clientInvoiceIds) await tx.delete(clientCreditNotes).where(eq(clientCreditNotes.invoiceId, id));
  });
  await cleanupCreated(ids);
}, 120_000);

describe("avoir immuable (trigger client_credit_notes_immutable)", { timeout: 60_000 }, () => {
  it("UPDATE, DELETE et TRUNCATE refusés ; la levée explicite les autorise", async () => {
    const invoice = await makeInvoice();
    const { creditNote } = await createCreditNote(invoice.id, { amountHt: 1000, reason: "TEST remise", requestKey: key() }, userId);
    noteIds.push(creditNote.id);
    const name = "client_credit_notes_immutable";

    await expectRefused(() => db.execute(sql`UPDATE client_credit_notes SET reason = 'autre' WHERE id = ${creditNote.id}`), name, "update motif");
    await expectRefused(() => db.execute(sql`UPDATE client_credit_notes SET amount_ht = 1 WHERE id = ${creditNote.id}`), name, "update montant");
    await expectRefused(() => db.update(clientCreditNotes).set({ reason: "autre" }).where(eq(clientCreditNotes.id, creditNote.id)), name, "drizzle update");
    await expectRefused(() => db.execute(sql`DELETE FROM client_credit_notes WHERE id = ${creditNote.id}`), name, "delete");
    await expectRefused(() => db.execute(sql`TRUNCATE client_credit_notes`), name, "truncate");

    const [still] = await db.select().from(clientCreditNotes).where(eq(clientCreditNotes.id, creditNote.id));
    expect(still.reason).toBe("TEST remise");

    // Levée explicite pour la transaction : le nettoyage de test passe, et pas autrement.
    await db.transaction(async (tx) => {
      await withMoneyOverride(tx, "test de levée");
      await tx.delete(clientCreditNotes).where(eq(clientCreditNotes.id, creditNote.id));
    });
    expect(await db.select().from(clientCreditNotes).where(eq(clientCreditNotes.id, creditNote.id))).toHaveLength(0);
  });

  it("la facture d'un avoir ne se supprime pas (clé étrangère RESTRICT) sans lever le verrou sur les avoirs", async () => {
    const invoice = await makeInvoice();
    await createCreditNote(invoice.id, { amountHt: 500, reason: "TEST fk", requestKey: key() }, userId);
    let caught: unknown;
    try {
      await db.transaction(async (tx) => {
        await withMoneyOverride(tx, "test fk");
        await tx.delete(clientInvoices).where(eq(clientInvoices.id, invoice.id));
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect((await invoiceRow(invoice.id)).id).toBe(invoice.id);
  });
});

describe("cumul crédité sur la facture (trigger client_invoices_issued_locked)", { timeout: 60_000 }, () => {
  it("monte jusqu'au TTC ; baisse et dépassement refusés", async () => {
    const invoice = await makeInvoice();
    const id = invoice.id;
    await db.execute(sql`UPDATE client_invoices SET credited_amount_ttc = 40000, balance = 60000, status = 'partial' WHERE id = ${id}`);
    expect((await invoiceRow(id)).creditedAmountTtc).toBe("40000.00");

    const locked = "client_invoices_issued_locked";
    await expectRefused(() => db.execute(sql`UPDATE client_invoices SET credited_amount_ttc = 39999 WHERE id = ${id}`), locked, "baisse");
    await expectRefused(() => db.execute(sql`UPDATE client_invoices SET credited_amount_ttc = 0 WHERE id = ${id}`), locked, "remise à zéro");
    await expectRefused(() => db.execute(sql`UPDATE client_invoices SET credited_amount_ttc = 100000.01 WHERE id = ${id}`), locked, "au-delà du TTC");

    await db.execute(sql`UPDATE client_invoices SET credited_amount_ttc = 100000, balance = 0, status = 'paid' WHERE id = ${id}`);
    expect(await invoiceRow(id)).toMatchObject({ creditedAmountTtc: "100000.00", balance: "0.00", status: "paid" });
  });

  it("une facture annulée ne reçoit plus d'avoir en base", async () => {
    const invoice = await makeInvoice();
    await db.execute(sql`UPDATE client_invoices SET status = 'cancelled' WHERE id = ${invoice.id}`);
    await expectRefused(
      () => db.execute(sql`UPDATE client_invoices SET credited_amount_ttc = 10 WHERE id = ${invoice.id}`),
      "client_invoices_issued_locked",
      "avoir sur annulée",
    );
  });
});

describe("cohérence statut et solde (trigger client_invoices_issued_locked)", { timeout: 60_000 }, () => {
  const locked = "client_invoices_issued_locked";

  it("payée exige un solde nul ; un solde nul impose payée ; le cycle légitime passe", async () => {
    const invoice = await makeInvoice();
    const id = invoice.id;
    await expectRefused(() => db.execute(sql`UPDATE client_invoices SET status = 'paid' WHERE id = ${id}`), locked, "payée avec solde");
    await expectRefused(() => db.execute(sql`UPDATE client_invoices SET status = 'paid', balance = 10 WHERE id = ${id}`), locked, "payée solde 10");
    await expectRefused(() => db.execute(sql`UPDATE client_invoices SET status = 'partial', balance = 0 WHERE id = ${id}`), locked, "solde nul partiel");
    await expectRefused(() => db.execute(sql`UPDATE client_invoices SET status = 'overdue', balance = 0 WHERE id = ${id}`), locked, "solde nul en retard");
    await db.execute(sql`UPDATE client_invoices SET status = 'partial', balance = 50000 WHERE id = ${id}`);
    await db.execute(sql`UPDATE client_invoices SET status = 'overdue' WHERE id = ${id}`);
    await db.execute(sql`UPDATE client_invoices SET status = 'paid', balance = 0 WHERE id = ${id}`);
    expect(await invoiceRow(id)).toMatchObject({ status: "paid", balance: "0.00" });
  });

  it("une facture payée ne repasse pas en attente, partielle ou en retard", async () => {
    const invoice = await makeInvoice();
    await db.execute(sql`UPDATE client_invoices SET status = 'paid', balance = 0 WHERE id = ${invoice.id}`);
    for (const status of ["pending", "partial", "overdue"]) {
      await expectRefused(() => db.execute(sql.raw(`UPDATE client_invoices SET status = '${status}' WHERE id = ${invoice.id}`)), locked, `payée vers ${status}`);
    }
    // Levée explicite : la correction d'exploitation reste possible.
    await db.transaction(async (tx) => {
      await withMoneyOverride(tx, "test de levée");
      await tx.execute(sql`UPDATE client_invoices SET status = 'pending', balance = amount_ttc WHERE id = ${invoice.id}`);
    });
    expect((await invoiceRow(invoice.id)).status).toBe("pending");
  });

  it("l'avoir qui solde la facture la passe en payée", async () => {
    const invoice = await makeInvoice();
    const r = await createCreditNote(invoice.id, { amountHt: 100000, reason: "TEST solde total", requestKey: key() }, userId);
    expect(r.status).toBe("paid");
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: "paid", balance: "0.00", creditedAmountTtc: "100000.00" });
  });
});

describe("service createCreditNote", { timeout: 60_000 }, () => {
  it("rejeu : même clé, même avoir, une seule ligne, solde inchangé", async () => {
    const invoice = await makeInvoice();
    const requestKey = key();
    const first = await createCreditNote(invoice.id, { amountHt: 10000, reason: "TEST rejeu", requestKey }, userId);
    const second = await createCreditNote(invoice.id, { amountHt: 10000, reason: "TEST rejeu", requestKey }, userId);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.creditNote.id).toBe(first.creditNote.id);
    expect(second.creditNote.creditNoteNumber).toBe(first.creditNote.creditNoteNumber);
    expect(first.creditNote.creditNoteNumber).toMatch(/^AV-\d{8}-\d{3}$/);
    const rows = await db.select().from(clientCreditNotes).where(eq(clientCreditNotes.invoiceId, invoice.id));
    expect(rows).toHaveLength(1);
    expect(await invoiceRow(invoice.id)).toMatchObject({ balance: "90000.00", creditedAmountTtc: "10000.00", status: "partial" });
  });

  it("course : deux avoirs simultanés de 70 % du solde, un seul passe", async () => {
    const invoice = await makeInvoice();
    const results = await Promise.allSettled([
      createCreditNote(invoice.id, { amountHt: 70000, reason: "TEST course A", requestKey: key() }, userId),
      createCreditNote(invoice.id, { amountHt: 70000, reason: "TEST course B", requestKey: key() }, userId),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as { status?: number }).status).toBe(409);
    expect(await db.select().from(clientCreditNotes).where(eq(clientCreditNotes.invoiceId, invoice.id))).toHaveLength(1);
    expect(await invoiceRow(invoice.id)).toMatchObject({ balance: "30000.00", creditedAmountTtc: "70000.00" });
  });

  it("numéros consécutifs le même jour", async () => {
    const invoice = await makeInvoice();
    const a = await createCreditNote(invoice.id, { amountHt: 100, reason: "TEST num A", requestKey: key() }, userId);
    const b = await createCreditNote(invoice.id, { amountHt: 100, reason: "TEST num B", requestKey: key() }, userId);
    const suffix = (n: string) => Number(n.split("-")[2]);
    expect(a.creditNote.creditNoteNumber.slice(0, 11)).toBe(b.creditNote.creditNoteNumber.slice(0, 11));
    expect(suffix(b.creditNote.creditNoteNumber)).toBe(suffix(a.creditNote.creditNoteNumber) + 1);
  });
});
