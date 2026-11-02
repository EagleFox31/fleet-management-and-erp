import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestSupplierInvoice, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Sécurité : le justificatif d'un règlement fournisseur n'est servi que s'il est sous `uploads/`.
 * `proofReference` est libre via `POST /:id/payment` (endpoint legacy) ; l'ancien contrôle
 * `startsWith(<cwd>/uploads)` laissait passer un dossier voisin (`uploads-old/…`).
 */

const PROOF_DIR = path.join(process.cwd(), "uploads", "supplier-invoices", "settlements");
const PROOF_NAME = uniqueTestToken("proofpath");
// Dossier voisin de uploads/ dont le nom commence par « uploads » : hors périmètre.
const SIBLING_DIR = path.join(process.cwd(), `uploads-${uniqueTestToken("sibling")}`);
const SECRET = "TEST-secret-hors-uploads";

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();

async function api(method: string, url: string, body?: unknown) {
  const response = await fetch(baseUrl + url, {
    method,
    headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Fichier servi : le corps est le contenu brut.
  }
  return { status: response.status, body: parsed, text };
}

async function approvedInvoice() {
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  const invoice = await createTestSupplierInvoice({ supplierId: supplier.id, status: "approved" });
  ids.invoiceIds.push(invoice.id);
  return invoice;
}

/** Règlement legacy avec un `proofReference` libre, puis lecture de son justificatif. */
async function proofOfLegacyPayment(proofReference: string) {
  const invoice = await approvedInvoice();
  const paid = await api("POST", `/api/supplier-invoices/${invoice.id}/payment`, {
    paymentDate: "2026-10-29",
    paymentMethod: "virement",
    proofReference,
  });
  expect(paid.status).toBe(200);
  const settlements = await api("GET", `/api/supplier-invoices/${invoice.id}/settlements`);
  const settlement = settlements.body.find((item: any) => item.proofReference === proofReference);
  expect(settlement).toBeDefined();
  return api("GET", `/api/supplier-invoices/${invoice.id}/settlements/${settlement.id}/proof`);
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const accountant = await createTestUser({ role: "admin" });
  ids.userIds.push(accountant.id);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: accountant.username, password: TEST_USER_PASSWORD }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];

  fs.mkdirSync(SIBLING_DIR, { recursive: true });
  fs.writeFileSync(path.join(SIBLING_DIR, "secret.txt"), SECRET);
}, 120000);

afterAll(async () => {
  fs.rmSync(SIBLING_DIR, { recursive: true, force: true });
  if (fs.existsSync(PROOF_DIR)) {
    for (const name of fs.readdirSync(PROOF_DIR).filter((n) => n.startsWith(PROOF_NAME))) {
      fs.unlinkSync(path.join(PROOF_DIR, name));
    }
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("justificatif de règlement fournisseur : jamais hors de uploads/", { timeout: 120000 }, () => {
  it("un dossier voisin dont le nom commence par « uploads » n'est pas servi (avant : 200 + contenu)", async () => {
    const proof = await proofOfLegacyPayment(`/${path.basename(SIBLING_DIR)}/secret.txt`);
    expect(proof.status).toBe(404);
    expect(proof.text).not.toContain(SECRET);
    expect(proof.body.message).toBe("Justificatif introuvable");
  });

  it("une remontée `..` hors de uploads/ donne 404 lisible, sans détail technique", async () => {
    const proof = await proofOfLegacyPayment("/uploads/../package.json");
    expect(proof.status).toBe(404);
    expect(proof.body.message).toBe("Justificatif introuvable");
    expect(proof.text).not.toContain("dependencies");
  });

  it("non-régression : le justificatif téléversé est servi", async () => {
    const invoice = await approvedInvoice();
    const form = new FormData();
    form.append("amount", "1000");
    form.append("paymentMethod", "virement");
    form.append("paymentReference", uniqueTestToken("ref"));
    form.append("paymentDate", "2026-10-29");
    form.append("proofFile", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), `${PROOF_NAME}.pdf`);
    const created = await fetch(`${baseUrl}/api/supplier-invoices/${invoice.id}/settlements`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    });
    expect(created.status).toBe(201);
    const settlements = await api("GET", `/api/supplier-invoices/${invoice.id}/settlements`);
    const proof = await api("GET", `/api/supplier-invoices/${invoice.id}/settlements/${settlements.body[0].id}/proof`);
    expect(proof.status).toBe(200);
    expect(proof.text).toBe("%PDF-1.4 TEST");
  });
});
