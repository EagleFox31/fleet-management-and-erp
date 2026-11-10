import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const forced = vi.hoisted(() => ({ numbers: [] as string[] }));
import { db } from "../../server/db";
import { CLIENT_CREDIT_NOTES_SQL, CLIENT_INVOICES_ISSUED_LOCK_SQL } from "../../server/init-database";
import { withMoneyOverride } from "../../server/lib/money-override";
import { clientCreditNotes, clientInvoices } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient, createTestClientInvoice, createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Avoirs : rejeu par request_key (même contenu seulement) et collision sur le numéro d'avoir
 * (un nouvel essai, puis 409 distinct de celui de la clé de requête).
 */
const ids = createIdBag();
let userId = 0;
let clientId = 0;
let createCreditNote: typeof import("../../server/services/client-credit-note-service").createCreditNote;
const key = () => uniqueTestToken("avkey");

async function makeInvoice() {
  const row = await createTestClientInvoice({
    clientId,
    amountHT: "100000.00",
    vatRate: "0",
    vatAmount: "0.00",
    amountTTC: "100000.00",
    balance: "100000.00",
    createdBy: userId,
    notes: "TEST avoir rejeu",
  });
  ids.clientInvoiceIds.push(row.id);
  return row;
}
const invoiceRow = async (id: number) => (await db.select().from(clientInvoices).where(eq(clientInvoices.id, id)))[0];
const notesOf = (invoiceId: number) => db.select().from(clientCreditNotes).where(eq(clientCreditNotes.invoiceId, invoiceId));

async function failureOf(run: () => Promise<unknown>): Promise<{ status?: number; message?: string }> {
  try {
    await run();
  } catch (error) {
    return { status: (error as { status?: number }).status, message: (error as Error).message };
  }
  return {};
}

beforeAll(async () => {
  // Le service est rechargé avec une numérotation simulée : la config d'intégration partage le cache de modules
  // entre fichiers, un vi.mock statique serait ignoré si un autre fichier a déjà chargé le service.
  vi.resetModules();
  vi.doMock("../../server/lib/daily-document-number", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../server/lib/daily-document-number")>();
    return {
      ...original,
      // Numéros imposés d'abord (collision simulée), puis la numérotation réelle.
      nextDailyNumber: (...args: Parameters<typeof original.nextDailyNumber>) =>
        forced.numbers.length ? Promise.resolve(forced.numbers.shift()!) : original.nextDailyNumber(...args),
    };
  });
  ({ createCreditNote } = await import("../../server/services/client-credit-note-service"));
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
  vi.doUnmock("../../server/lib/daily-document-number");
  await db.transaction(async (tx) => {
    await withMoneyOverride(tx, "nettoyage de données de test");
    for (const id of ids.clientInvoiceIds) await tx.delete(clientCreditNotes).where(eq(clientCreditNotes.invoiceId, id));
  });
  await cleanupCreated(ids);
}, 120_000);

describe("rejeu d'un avoir", { timeout: 60_000 }, () => {
  it("même clé, autre montant ou autre motif : 409, rien d'écrit ; rejeu identique : le même avoir", async () => {
    const invoice = await makeInvoice();
    const requestKey = key();
    const first = await createCreditNote(invoice.id, { amountHt: 10000, reason: "TEST motif A", requestKey }, userId);

    const otherAmount = await failureOf(() => createCreditNote(invoice.id, { amountHt: 20000, reason: "TEST motif A", requestKey }, userId));
    const otherReason = await failureOf(() => createCreditNote(invoice.id, { amountHt: 10000, reason: "TEST motif B", requestKey }, userId));
    expect(otherAmount.status).toBe(409);
    expect(otherReason.status).toBe(409);
    expect(otherAmount.message).toMatch(/montant ou de motif/);

    const same = await createCreditNote(invoice.id, { amountHt: 10000, reason: "TEST motif A", requestKey }, userId);
    expect(same.replayed).toBe(true);
    expect(same.creditNote.id).toBe(first.creditNote.id);
    expect(await notesOf(invoice.id)).toHaveLength(1);
    expect(await invoiceRow(invoice.id)).toMatchObject({ balance: "90000.00", creditedAmountTtc: "10000.00" });
  });
});

describe("collision sur le numéro d'avoir", { timeout: 60_000 }, () => {
  it("une collision : un nouvel essai relit le numéro suivant et l'avoir est émis", async () => {
    const a = await makeInvoice();
    const b = await makeInvoice();
    const taken = (await createCreditNote(a.id, { amountHt: 1000, reason: "TEST numéro pris", requestKey: key() }, userId)).creditNote.creditNoteNumber;
    forced.numbers.push(taken);
    const res = await createCreditNote(b.id, { amountHt: 2000, reason: "TEST après collision", requestKey: key() }, userId);
    expect(forced.numbers).toHaveLength(0); // le numéro en collision a bien été servi puis rejeté
    expect(res.replayed).toBe(false);
    expect(res.creditNote.creditNoteNumber).not.toBe(taken);
    expect(await notesOf(b.id)).toHaveLength(1);
    expect(await invoiceRow(b.id)).toMatchObject({ balance: "98000.00" });
  });

  it("collision persistante : 409 distinct de celui de la clé, rien d'écrit", async () => {
    const a = await makeInvoice();
    const b = await makeInvoice();
    const taken = (await createCreditNote(a.id, { amountHt: 1000, reason: "TEST numéro pris", requestKey: key() }, userId)).creditNote.creditNoteNumber;
    forced.numbers.push(taken, taken);
    const res = await failureOf(() => createCreditNote(b.id, { amountHt: 2000, reason: "TEST collision persistante", requestKey: key() }, userId));
    expect({ res, leftover: forced.numbers.length }).toMatchObject({ res: { status: 409 }, leftover: 0 });
    expect(res.message).toMatch(/numéro d'avoir/);
    expect(res.message).not.toMatch(/en cours d'enregistrement/);
    expect(await notesOf(b.id)).toHaveLength(0);
    expect(await invoiceRow(b.id)).toMatchObject({ balance: "100000.00", creditedAmountTtc: "0.00" });
  });
});
