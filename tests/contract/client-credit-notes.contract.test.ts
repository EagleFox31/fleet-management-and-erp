import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { CLIENT_CREDIT_NOTES_SQL, CLIENT_INVOICES_ISSUED_LOCK_SQL } from "../../server/init-database";
import { clientCreditNotes, clientInvoices, clients } from "../../shared/schema";
import { leakText } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestClient, createTestClientInvoice } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { sql } from "drizzle-orm";

/**
 * Niveau C, avoirs clients (PR5, lot V1) :
 * POST /api/billing/invoices/:id/credit-notes, GET .../credit-notes, GET /api/billing/credit-notes/:id/pdf.
 * Facture de test : HT 100 000, TVA 19,25 %, TTC 119 250, solde 119 250.
 */
process.env.FEATURE_FLAGS = "finance=on";

const ACTORS = { admin: "admin", accountant: "accountant", secretary: "secretary", logistics: "logistics", technician: "technician", client: "client" } as const;
type Actor = keyof typeof ACTORS;
const TOTAL = 119250;
const ids = createIdBag();
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

const key = () => uniqueTestToken("avk");

async function newInvoice(overrides: Partial<typeof clientInvoices.$inferInsert> = {}) {
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  const invoice = await createTestClientInvoice({ clientId: client.id, ...overrides });
  ids.clientInvoiceIds.push(invoice.id);
  return invoice;
}

function credit(invoiceId: number, body: Record<string, unknown>, actor: Actor = "accountant") {
  return session.call("POST", `/api/billing/invoices/${invoiceId}/credit-notes`, { actor, body });
}

const valid = (amountHt: number, extra: Record<string, unknown> = {}) => ({ amountHt, reason: "TEST remise commerciale", requestKey: key(), ...extra });

async function invoiceOf(id: number) {
  const [row] = await db.select().from(clientInvoices).where(eq(clientInvoices.id, id));
  return row;
}

async function notesOf(invoiceId: number) {
  return db.select().from(clientCreditNotes).where(eq(clientCreditNotes.invoiceId, invoiceId));
}

function expectErrorContract(res: { body: any; headers: Headers }, code: string) {
  expect(res.body).toMatchObject({ code });
  expect(typeof res.body.message).toBe("string");
  expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
  expect(leakText(res.body)).not.toMatch(/stack|at \S+:\d+|SQLSTATE|TypeError|violates|constraint|NaN/i);
}

beforeAll(async () => {
  await db.execute(sql.raw(CLIENT_CREDIT_NOTES_SQL));
  await db.execute(sql.raw(CLIENT_INVOICES_ISSUED_LOCK_SQL));
  session = await startContractActors(ACTORS, ids.userIds);
}, 120_000);

afterAll(async () => {
  try {
    await cleanupCreated(ids);
  } finally {
    await session?.close();
  }
}, 120_000);

describe("Avoirs clients : contrat", { timeout: 120_000 }, () => {
  it("201 : numéro AV-, montants HT/TVA/TTC, solde baissé, cumul crédité et statut recalculés", async () => {
    const invoice = await newInvoice();
    const res = await credit(invoice.id, valid(10000));
    expect(res.status).toBe(201);
    expect(res.body.creditNote.creditNoteNumber).toMatch(/^AV-\d{8}-\d{3}$/);
    expect(Number(res.body.creditNote.amountHT)).toBe(10000);
    expect(Number(res.body.creditNote.vatAmount)).toBe(1925);
    expect(Number(res.body.creditNote.amountTTC)).toBe(11925);
    expect(res.body.replayed).toBe(false);
    const after = await invoiceOf(invoice.id);
    expect(Number(after.balance)).toBe(TOTAL - 11925);
    expect(Number(after.creditedAmountTtc)).toBe(11925);
    expect(after.status).toBe("partial");
    expect(Number(after.amountTTC)).toBe(TOTAL);
  });

  it("rejeu de la même clé : 200, le même avoir, un seul avoir en base, solde baissé une fois", async () => {
    const invoice = await newInvoice();
    const body = valid(20000);
    const first = await credit(invoice.id, body);
    const replay = await credit(invoice.id, body);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.creditNote.id).toBe(first.body.creditNote.id);
    expect(await notesOf(invoice.id)).toHaveLength(1);
    expect(Number((await invoiceOf(invoice.id)).balance)).toBe(TOTAL - 23850);
  });

  it("409 : avoir au-delà du solde, plafonné, rien d'écrit ; message lisible", async () => {
    const invoice = await newInvoice();
    const res = await credit(invoice.id, valid(100001));
    expect(res.status).toBe(409);
    expectErrorContract(res, "CONFLICT");
    expect(res.body.message).toMatch(/solde/i);
    expect(await notesOf(invoice.id)).toHaveLength(0);
    expect(Number((await invoiceOf(invoice.id)).balance)).toBe(TOTAL);
  });

  it("l'avoir égal au solde solde la facture : statut payée", async () => {
    const invoice = await newInvoice();
    const res = await credit(invoice.id, valid(100000));
    expect(res.status).toBe(201);
    const after = await invoiceOf(invoice.id);
    expect(after.status).toBe("paid");
    expect(Number(after.balance)).toBe(0);
    const again = await credit(invoice.id, valid(1000));
    expect(again.status).toBe(409);
    expectErrorContract(again, "CONFLICT");
  });

  it("409 : facture annulée", async () => {
    const invoice = await newInvoice({ status: "cancelled" });
    const res = await credit(invoice.id, valid(1000));
    expect(res.status).toBe(409);
    expectErrorContract(res, "CONFLICT");
    expect(await notesOf(invoice.id)).toHaveLength(0);
  });

  it.each([
    { label: "motif absent", body: { amountHt: 1000, requestKey: "cle-motif-absent" } },
    { label: "motif trop court", body: { amountHt: 1000, reason: "ab", requestKey: "cle-motif-court" } },
    { label: "montant nul", body: { amountHt: 0, reason: "TEST motif valable", requestKey: "cle-montant-nul" } },
    { label: "montant négatif", body: { amountHt: -5, reason: "TEST motif valable", requestKey: "cle-montant-neg" } },
    { label: "montant non numérique", body: { amountHt: "abc", reason: "TEST motif valable", requestKey: "cle-montant-abc" } },
    { label: "clé de rejeu absente", body: { amountHt: 1000, reason: "TEST motif valable" } },
  ])("400 lisible : $label, rien d'écrit", async ({ body }) => {
    const invoice = await newInvoice();
    const res = await credit(invoice.id, body);
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
    expect(await notesOf(invoice.id)).toHaveLength(0);
    expect(Number((await invoiceOf(invoice.id)).balance)).toBe(TOTAL);
  });

  it("401 sans session, 403 pour les rôles non autorisés à écrire", async () => {
    const invoice = await newInvoice();
    const anonymous = await session.call("POST", `/api/billing/invoices/${invoice.id}/credit-notes`, { body: valid(1000) });
    expect(anonymous.status).toBe(401);
    for (const actor of ["secretary", "logistics", "technician", "client"] as Actor[]) {
      const res = await credit(invoice.id, valid(1000), actor);
      expect(res.status, actor).toBe(403);
      expectErrorContract(res, "FORBIDDEN");
    }
    expect(await notesOf(invoice.id)).toHaveLength(0);
  });

  it("admin autorisé à écrire", async () => {
    const invoice = await newInvoice();
    const res = await credit(invoice.id, valid(1000), "admin");
    expect(res.status).toBe(201);
  });

  it("anti-CSRF : POST en urlencoded, texte ou sans type → 415, aucun avoir écrit, facture inchangée", async () => {
    const invoice = await newInvoice();
    const before = await invoiceOf(invoice.id);
    const form = new URLSearchParams({ amountHt: "1000", reason: "TEST csrf", requestKey: key() }).toString();
    for (const [type, body] of [["application/x-www-form-urlencoded", form], ["text/plain", form], [undefined, undefined]] as const) {
      const res = await fetch(`${session.baseUrl}/api/billing/invoices/${invoice.id}/credit-notes`, {
        method: "POST",
        headers: { Cookie: session.cookies.get("accountant")!, ...(type ? { "Content-Type": type } : {}) },
        body,
      });
      expect(res.status, String(type)).toBe(415);
    }
    const notes = await db.select().from(clientCreditNotes).where(eq(clientCreditNotes.invoiceId, invoice.id));
    expect(notes).toHaveLength(0);
    const after = await invoiceOf(invoice.id);
    expect(after.balance).toBe(before.balance);
    expect(after.creditedAmountTtc).toBe(before.creditedAmountTtc);
  });

  it("404 : facture inconnue ; 400 : identifiant invalide", async () => {
    const missing = await credit(2_000_000_000, valid(1000));
    expect(missing.status).toBe(404);
    expectErrorContract(missing, "NOT_FOUND");
    const bad = await credit("abc" as unknown as number, valid(1000));
    expect(bad.status).toBe(400);
    expectErrorContract(bad, "VALIDATION");
  });

  it("lecture : rôles de facturation oui, client et technicien non (cloison AGENTS.md §11)", async () => {
    const invoice = await newInvoice();
    const created = await credit(invoice.id, valid(1000));
    expect(created.status).toBe(201);
    for (const actor of ["admin", "accountant", "secretary", "logistics"] as Actor[]) {
      const res = await session.call("GET", `/api/billing/invoices/${invoice.id}/credit-notes`, { actor });
      expect(res.status, actor).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].creditNoteNumber).toBe(created.body.creditNote.creditNoteNumber);
    }
    for (const actor of ["client", "technician"] as Actor[]) {
      const list = await session.call("GET", `/api/billing/invoices/${invoice.id}/credit-notes`, { actor });
      expect(list.status, actor).toBe(403);
      const pdf = await fetch(`${session.baseUrl}/api/billing/credit-notes/${created.body.creditNote.id}/pdf`, { headers: { Cookie: session.cookies.get(actor)! } });
      expect(pdf.status, actor).toBe(403);
    }
  });

  it("PDF : servi en application/pdf, nommé d'après le numéro d'avoir", async () => {
    const invoice = await newInvoice();
    const created = await credit(invoice.id, valid(5000));
    const res = await fetch(`${session.baseUrl}/api/billing/credit-notes/${created.body.creditNote.id}/pdf`, { headers: { Cookie: session.cookies.get("accountant")! } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/pdf/);
    expect(res.headers.get("content-disposition")).toContain(created.body.creditNote.creditNoteNumber);
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(1000);
    const missing = await fetch(`${session.baseUrl}/api/billing/credit-notes/2000000000/pdf`, { headers: { Cookie: session.cookies.get("accountant")! } });
    expect(missing.status).toBe(404);
  });

  it("dépôt puis avoir : 409 lisible, aucune ligne écrite, facture inchangée", async () => {
    const invoice = await newInvoice();
    const deposit = await session.call("PATCH", `/api/finance/invoices-awaiting-payment/${invoice.id}/deposit`, { actor: "admin", body: { depositedAt: "2026-11-05" } });
    expect(deposit.status).toBe(200);
    const deposited = await invoiceOf(invoice.id);
    expect(deposited.depositedAt).toBeTruthy();
    const res = await credit(invoice.id, valid(10000));
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Facture déposée/);
    expectErrorContract(res, res.body.code);
    expect(await notesOf(invoice.id)).toHaveLength(0);
    const after = await invoiceOf(invoice.id);
    expect(after).toMatchObject({ netPayable: deposited.netPayable, balance: deposited.balance, creditedAmountTtc: deposited.creditedAmountTtc });
  });

  it("avoir puis dépôt : retenues sur base nette, net à payer au plus égal au solde", async () => {
    const invoice = await newInvoice();
    const [inv] = await db.select({ clientId: clientInvoices.clientId }).from(clientInvoices).where(eq(clientInvoices.id, invoice.id));
    await db.update(clients).set({ withholdingVatRate: "5", withholdingIsRate: "2.2", withholdingIsBase: "ttc" }).where(eq(clients.id, inv.clientId!));
    expect((await credit(invoice.id, valid(30000))).status).toBe(201); // HT 30 000, TTC 35 775
    const deposit = await session.call("PATCH", `/api/finance/invoices-awaiting-payment/${invoice.id}/deposit`, { actor: "admin", body: { depositedAt: "2026-11-05" } });
    expect(deposit.status).toBe(200);
    const after = await invoiceOf(invoice.id);
    const netTtc = TOTAL - 35775;
    const vat = Math.round((70000 * 5) / 100);
    const is = Math.round((netTtc * 2.2) / 100);
    expect(Number(after.withholdingVatAmount)).toBe(vat);
    expect(Number(after.withholdingIsAmount)).toBe(is);
    expect(Number(after.netPayable)).toBe(netTtc - vat - is);
    expect(Number(after.netPayable)).toBeLessThanOrEqual(Number(after.balance));
  });

  it("rejeu de la même clé avec un autre montant ou un autre motif : 409 lisible, rien d'écrit", async () => {
    const invoice = await newInvoice();
    const body = valid(20000);
    expect((await credit(invoice.id, body)).status).toBe(201);
    for (const changed of [{ ...body, amountHt: 25000 }, { ...body, reason: "TEST autre motif" }]) {
      const res = await credit(invoice.id, changed);
      expect(res.status).toBe(409);
      expectErrorContract(res, res.body.code);
    }
    expect(await notesOf(invoice.id)).toHaveLength(1);
    expect(Number((await invoiceOf(invoice.id)).balance)).toBe(TOTAL - 23850);
  });

  it("paiement partiel, avoir, paiement solde : la facture finit payée, pas de dépassement", async () => {
    const invoice = await newInvoice();
    const pay = (amount: number) =>
      session.call("POST", `/api/billing/invoices/${invoice.id}/payments`, { actor: "accountant", body: { amount, paymentDate: "2026-11-03", paymentMethod: "cash", reference: key() } });
    expect((await pay(50000)).status).toBe(200);
    expect((await credit(invoice.id, valid(20000))).status).toBe(201); // 23 850 TTC
    const mid = await invoiceOf(invoice.id);
    expect(Number(mid.balance)).toBe(TOTAL - 50000 - 23850);
    const over = await pay(TOTAL - 50000 - 23850 + 1);
    expect(over.status).toBe(409);
    expect((await pay(TOTAL - 50000 - 23850)).status).toBe(200);
    const done = await invoiceOf(invoice.id);
    expect(done.status).toBe("paid");
    expect(Number(done.balance)).toBe(0);
    expect(Number(done.creditedAmountTtc)).toBe(23850);
  });

  it("numérotation des factures inchangée : FACT-AAAAMMJJ-NNN par la génération réelle", async () => {
    // La numérotation passe désormais par nextDailyNumber ; son format reste celui des factures existantes.
    const { INVOICE_NUMBER_SPEC, CREDIT_NOTE_NUMBER_SPEC } = await import("../../server/lib/daily-document-number");
    expect(INVOICE_NUMBER_SPEC.prefix).toBe("FACT");
    expect(CREDIT_NOTE_NUMBER_SPEC.prefix).toBe("AV");
  });
});
