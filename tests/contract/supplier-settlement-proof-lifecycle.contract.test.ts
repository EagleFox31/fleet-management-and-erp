import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestSupplierInvoice, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Justificatif de règlement fournisseur : gardé si et seulement si un règlement enregistré le
 * référence (patron de #178, LESSONS_LEARNED). Avant : un identifiant de facture invalide
 * laissait le fichier orphelin, et une diffusion qui levait après l'enregistrement supprimait
 * le justificatif d'un règlement pourtant créé.
 */
const PROOF_DIR = path.join(process.cwd(), "uploads", "supplier-invoices", "settlements");
const MARKER = uniqueTestToken("lc").replace(/[^a-zA-Z0-9_-]/g, "_");

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();
const g = global as { broadcastUpdate?: unknown };
const originalBroadcast = g.broadcastUpdate;

const markedFiles = (label: string) =>
  fs.existsSync(PROOF_DIR) ? fs.readdirSync(PROOF_DIR).filter((name) => name.startsWith(`${MARKER}-${label}`)) : [];

async function postSettlement(invoiceRef: string | number, label: string) {
  const form = new FormData();
  form.append("amount", "1000");
  form.append("paymentMethod", "virement");
  form.append("paymentReference", uniqueTestToken("ref"));
  form.append("paymentDate", "2026-10-29");
  form.append("proofFile", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), `${MARKER}-${label}.pdf`);
  const res = await fetch(`${baseUrl}/api/supplier-invoices/${invoiceRef}/settlements`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function approvedInvoice() {
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  const invoice = await createTestSupplierInvoice({ supplierId: supplier.id, status: "approved" });
  ids.invoiceIds.push(invoice.id);
  return invoice;
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const admin = await createTestUser({ role: "admin" });
  ids.userIds.push(admin.id);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: admin.username, password: TEST_USER_PASSWORD }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
}, 120000);

afterEach(() => {
  g.broadcastUpdate = originalBroadcast;
});

afterAll(async () => {
  for (const name of markedFiles("")) fs.rmSync(path.join(PROOF_DIR, name), { force: true });
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("POST /api/supplier-invoices/:id/settlements : cycle de vie du justificatif", { timeout: 120000 }, () => {
  it("identifiant de facture invalide : 400, aucun fichier laissé sur le disque", async () => {
    const res = await postSettlement("abc", "badid");
    expect(res.status).toBe(400);
    expect(markedFiles("badid")).toEqual([]);
  });

  it("diffusion qui lève après l'enregistrement : 201, le justificatif référencé reste sur le disque", async () => {
    const invoice = await approvedInvoice();
    g.broadcastUpdate = () => {
      throw new Error("TEST diffusion indisponible");
    };
    const res = await postSettlement(invoice.id, "broadcast");
    expect(res.status).toBe(201);
    const reference: string = res.body.settlement.proofReference;
    expect(reference).toMatch(/^\/uploads\/supplier-invoices\/settlements\//);
    expect(fs.existsSync(path.join(PROOF_DIR, path.basename(reference)))).toBe(true);
    expect(markedFiles("broadcast")).toHaveLength(1);
  });

  it("non-régression : règlement enregistré sans incident, justificatif conservé", async () => {
    const invoice = await approvedInvoice();
    const res = await postSettlement(invoice.id, "ok");
    expect(res.status).toBe(201);
    expect(markedFiles("ok")).toHaveLength(1);
  });
});
