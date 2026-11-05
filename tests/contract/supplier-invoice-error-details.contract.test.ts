import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { threeWayMatchingService } from "../../server/services/three-way-matching-service";
import { getContractApp } from "../support/app";
import { apiErrorProblems, leakText, TECHNICAL } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestSupplierInvoice, createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Niveau C, AGENTS.md §10 : les routes de factures fournisseurs répondaient
 * `{ error, details: error.message }` en 500 et renvoyaient le message brut de multer sur un
 * justificatif refusé. Elles relaient désormais au gestionnaire central.
 *
 * Le cas 500 passait déjà avant le correctif (la garde de sortie du gestionnaire réécrit toute
 * 5xx) : c'est une non-régression. Le cas 400 était rouge.
 */

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const user = await createTestUser({ role: "secretary" });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.get("set-cookie")!.split(";")[0];
}, 120000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await cleanupCreated(ids);
});

describe("Factures fournisseurs : réponses d'erreur sans détail technique", { timeout: 120000 }, () => {
  it("une 500 renvoie le message générique et la référence, sans details", async () => {
    // Un id mal formé répond 400 depuis la lecture stricte des ids : la 500 est provoquée par le service.
    const spy = vi
      .spyOn(threeWayMatchingService, "getSupplierInvoiceById")
      .mockRejectedValueOnce(new Error("invalid input syntax for type integer: \"NaN\""));
    const res = await fetch(`${baseUrl}/api/supplier-invoices/2147483000`, { headers: { Cookie: cookie } });
    spy.mockRestore();
    const body = await res.json();
    expect(apiErrorProblems(res.status, body, 500, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(body).not.toHaveProperty("details");
    expect(leakText(body)).not.toMatch(TECHNICAL);
  });

  it("un justificatif refusé renvoie un 400 lisible, sans le message brut de multer", async () => {
    const supplier = await createTestSupplier();
    ids.supplierIds.push(supplier.id);
    const invoice = await createTestSupplierInvoice({ supplierId: supplier.id, status: "approved" });
    ids.invoiceIds.push(invoice.id);
    const form = new FormData();
    form.append("amount", "1000");
    form.append("paymentMethod", "cheque");
    form.append("paymentDate", "2026-10-29");
    form.append("proofFile", new Blob(["MZ"], { type: "application/x-msdownload" }), "virus.exe");
    const res = await fetch(`${baseUrl}/api/supplier-invoices/${invoice.id}/settlements`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    });
    const body = await res.json();
    expect(apiErrorProblems(res.status, body, 400)).toEqual([]);
    expect(body).not.toHaveProperty("details");
    expect(body.message).toMatch(/Formats acceptés/);
  });
});
