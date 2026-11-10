import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_DB_INTEGER_ID } from "../../shared/contracts/common";
import { apiErrorProblems } from "../support/api-error";
import { startContractSession } from "../support/contract-session";
import { createTestClient, createTestClientInvoice } from "../support/factories";

/**
 * GET /api/billing/invoices/:id/pdf : facture client imprimable.
 * - Rôles : `CLIENT_BILLING_EVENT_ROLES` (admin, secretary, logistics) ; autres profils 403.
 * - Réponse : PDF en pièce jointe nommée d'après le numéro de facture, longueur annoncée exacte.
 * - Facture sans fiche client : 404 lisible.
 * Écrit en base ; client et factures supprimés en fin de fichier.
 */
const pdfPath = (id: number | string) => `/api/billing/invoices/${id}/pdf`;

let session: Awaited<ReturnType<typeof startContractSession<"admin" | "secretary" | "logistics" | "management" | "technician" | "driver" | "client">>>;
let invoiceId = 0;
let invoiceNumber = "";
let orphanId = 0;

beforeAll(async () => {
  session = await startContractSession({
    admin: "admin",
    secretary: "secretary",
    logistics: "logistics",
    management: "management",
    technician: "technician",
    driver: "driver",
    client: "client",
  });
  const client = await createTestClient();
  session.ids.clientIds.push(client.id);
  const invoice = await createTestClientInvoice({ clientId: client.id, amountTTC: "119250.00", balance: "119250.00" });
  session.ids.clientInvoiceIds.push(invoice.id);
  invoiceId = invoice.id;
  invoiceNumber = invoice.invoiceNumber;
  // Facture émise = client gelé (trigger client_invoices_issued_locked) : l'orpheline naît sans client.
  const orphan = await createTestClientInvoice({ clientId: null });
  session.ids.clientInvoiceIds.push(orphan.id);
  orphanId = orphan.id;
}, 180000);

afterAll(async () => {
  await session.stop();
});

describe("droits", () => {
  it("sans session : 401", async () => {
    expect((await session.call("GET", pdfPath(invoiceId), { actor: null })).status).toBe(401);
  });

  it.each(["management", "technician", "driver", "client"] as const)("%s : 403", async (actor) => {
    expect((await session.call("GET", pdfPath(invoiceId), { actor })).status).toBe(403);
  });
});

describe("document", () => {
  it.each(["admin", "secretary", "logistics"] as const)("%s : PDF en pièce jointe, longueur exacte", async (actor) => {
    const res = await session.raw("GET", pdfPath(invoiceId), actor);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="Facture_${invoiceNumber}.pdf"`);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(Number(res.headers.get("content-length"))).toBe(bytes.length);
  });
});

describe("paramètres", () => {
  it("id non strict ou hors bornes : 400 ; facture inconnue : 404", async () => {
    for (const id of [`${invoiceId}abc`, "0", "2147483648"]) {
      expect((await session.call("GET", pdfPath(id), { actor: "admin" })).status).toBe(400);
    }
    const absent = await session.call("GET", pdfPath(MAX_DB_INTEGER_ID), { actor: "admin" });
    expect(apiErrorProblems(absent.status, absent.body, 404)).toEqual([]);
  });

  it("facture sans fiche client : 404 lisible, aucun PDF", async () => {
    const r = await session.call("GET", pdfPath(orphanId), { actor: "secretary" });
    expect(apiErrorProblems(r.status, r.body, 404)).toEqual([]);
    expect(r.headers.get("content-type")).toMatch(/application\/json/);
  });
});
