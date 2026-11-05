import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { clientInvoices, clients } from "../../shared/schema";
import { isoDateInZone } from "../../shared/contracts/kpi-period";
import { MAX_DB_INTEGER_ID } from "../../shared/contracts/common";
import {
  INVOICES_AWAITING_PAYMENT_PATH,
  invoicesAwaitingPaymentResponseSchema,
  type InvoiceAwaitingPayment,
} from "../../shared/contracts/invoices-awaiting-payment";
import { computeWithholdings } from "../../shared/finance/withholding";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import {
  createTestClient,
  createTestClientInvoice,
  createTestUser,
  TEST_USER_PASSWORD,
  type TestUserRole,
} from "../support/factories";

/**
 * Lot F1 phase B : factures en attente de paiement, dépôt chez le client, taux de retenue.
 * - Rôles : lecture admin/management/secretary, écriture admin/secretary.
 * - Calcul : base IS HT ou TTC selon le client ; retenues figées au dépôt, calculées avant.
 * - Dépôt : même date rejouée = 200 sans écriture ; autre date = 409 ; futur ou avant facture = 400.
 * Écrit en base ; tout est supprimé (clients et factures du lot).
 */
process.env.FEATURE_FLAGS = "finance=on";

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
const userIds = new Map<string, number>();

const CNPCC = { vatWithholdingRate: 19.25, isWithholdingRate: 2.2 };
const AMOUNTS = { amountHT: "100000.00", vatAmount: "19250.00", amountTTC: "119250.00" };

async function login(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  userIds.set(role, user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
}

async function call(method: string, path: string, role?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (role) headers.Cookie = cookies.get(role)!;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const depositPath = (id: number | string) => `${INVOICES_AWAITING_PAYMENT_PATH}/${id}/deposit`;
const withholdingPath = (id: number | string) => `/api/finance/clients/${id}/withholding`;

async function newClient(isBase: "ht" | "ttc") {
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  const r = await call("PATCH", withholdingPath(client.id), "secretary", { ...CNPCC, isBase });
  expect(r.status).toBe(200);
  return client.id;
}

async function newInvoice(clientId: number, overrides: { invoiceDate?: string; status?: "pending" | "paid" } = {}) {
  const invoice = await createTestClientInvoice({ clientId, ...AMOUNTS, ...overrides });
  ids.clientInvoiceIds.push(invoice.id);
  return invoice.id;
}

async function listed(invoiceId: number): Promise<InvoiceAwaitingPayment | undefined> {
  const r = await call("GET", INVOICES_AWAITING_PAYMENT_PATH, "admin");
  expect(r.status).toBe(200);
  return invoicesAwaitingPaymentResponseSchema.parse(r.body).items.find((i) => i.invoiceId === invoiceId);
}

const amounts = { amountHt: 100000, amountTtc: 119250 };

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of ["admin", "management", "secretary", "technician", "client", "logistics", "driver"] as const) await login(role);
}, 180000);

afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("droits", () => {
  it("sans session : 401", async () => {
    expect((await call("GET", INVOICES_AWAITING_PAYMENT_PATH)).status).toBe(401);
    expect((await call("PATCH", depositPath(1), undefined, { depositedAt: "2026-02-01" })).status).toBe(401);
  });

  it.each(["technician", "client"])("%s : 403 en lecture comme en écriture", async (role) => {
    expect((await call("GET", INVOICES_AWAITING_PAYMENT_PATH, role)).status).toBe(403);
    expect((await call("PATCH", depositPath(1), role, { depositedAt: "2026-02-01" })).status).toBe(403);
    expect((await call("PATCH", withholdingPath(1), role, { ...CNPCC, isBase: "ht" })).status).toBe(403);
  });

  it("drapeau finance coupé : 404 sur les trois routes, même pour un rôle autorisé", async () => {
    const flags = process.env.FEATURE_FLAGS;
    delete process.env.FEATURE_FLAGS;
    try {
      expect((await call("GET", INVOICES_AWAITING_PAYMENT_PATH, "admin")).status).toBe(404);
      expect((await call("PATCH", depositPath(1), "admin", { depositedAt: "2026-02-01" })).status).toBe(404);
      expect((await call("PATCH", withholdingPath(1), "admin", { ...CNPCC, isBase: "ht" })).status).toBe(404);
    } finally {
      process.env.FEATURE_FLAGS = flags;
    }
  });

  it("logistique : lit, n'écrit pas (décision du 2026-11-05)", async () => {
    const r = await call("GET", INVOICES_AWAITING_PAYMENT_PATH, "logistics");
    expect(r.status).toBe(200);
    expect(invoicesAwaitingPaymentResponseSchema.safeParse(r.body).success).toBe(true);
    expect((await call("PATCH", depositPath(1), "logistics", { depositedAt: "2026-02-01" })).status).toBe(403);
    expect((await call("PATCH", withholdingPath(1), "logistics", { ...CNPCC, isBase: "ht" })).status).toBe(403);
  });

  it("direction : lit, n'écrit pas", async () => {
    const r = await call("GET", INVOICES_AWAITING_PAYMENT_PATH, "management");
    expect(r.status).toBe(200);
    expect(invoicesAwaitingPaymentResponseSchema.safeParse(r.body).success).toBe(true);
    expect((await call("PATCH", depositPath(1), "management", { depositedAt: "2026-02-01" })).status).toBe(403);
    expect((await call("PATCH", withholdingPath(1), "management", { ...CNPCC, isBase: "ht" })).status).toBe(403);
  });
});

describe("calcul des retenues", () => {
  it("base IS HT ou TTC selon le client, calculée tant que la facture n'est pas déposée", async () => {
    const ht = await newInvoice(await newClient("ht"));
    const ttc = await newInvoice(await newClient("ttc"));
    const rowHt = await listed(ht);
    const rowTtc = await listed(ttc);
    expect(rowHt).toMatchObject({ withholdingIsBase: "ht", withholdingFrozen: false, depositedAt: null, daysSinceDeposit: null });
    expect(rowHt).toMatchObject(computeWithholdings(amounts, { ...CNPCC, isBase: "ht" }));
    expect(rowTtc).toMatchObject({ withholdingIsBase: "ttc", withholdingFrozen: false });
    expect(rowTtc).toMatchObject(computeWithholdings(amounts, { ...CNPCC, isBase: "ttc" }));
    expect(rowTtc!.withholdingIsAmount).toBeGreaterThan(rowHt!.withholdingIsAmount);
  });

  it("client sans taux : aucune retenue, net = TTC", async () => {
    const client = await createTestClient();
    ids.clientIds.push(client.id);
    const row = await listed(await newInvoice(client.id));
    expect(row).toMatchObject({ withholdingVatAmount: 0, withholdingIsAmount: 0, netPayable: 119250 });
  });

  it("facture soldée : absente de la liste", async () => {
    const paid = await newInvoice(await newClient("ht"), { status: "paid" });
    expect(await listed(paid)).toBeUndefined();
  });
});

describe("dépôt chez le client", () => {
  it("fige les retenues : un changement de taux ultérieur ne touche que les factures non déposées", async () => {
    const clientId = await newClient("ht");
    const deposited = await newInvoice(clientId);
    const pending = await newInvoice(clientId);
    const r = await call("PATCH", depositPath(deposited), "secretary", { depositedAt: "2026-02-01" });
    expect(r.status).toBe(200);
    const frozen = computeWithholdings(amounts, { ...CNPCC, isBase: "ht" });
    expect(r.body).toMatchObject({ ...frozen, withholdingFrozen: true, depositedAt: "2026-02-01" });

    const changed = await call("PATCH", withholdingPath(clientId), "admin", { vatWithholdingRate: 50, isWithholdingRate: 5, isBase: "ttc" });
    expect(changed.status).toBe(200);
    expect(await listed(deposited)).toMatchObject({ ...frozen, withholdingFrozen: true });
    expect(await listed(pending)).toMatchObject({
      ...computeWithholdings(amounts, { vatWithholdingRate: 50, isWithholdingRate: 5, isBase: "ttc" }),
      withholdingFrozen: false,
    });
  });

  it("même date rejouée : 200 sans réécriture ; autre date : 409", async () => {
    const id = await newInvoice(await newClient("ht"));
    expect((await call("PATCH", depositPath(id), "admin", { depositedAt: "2026-02-01" })).status).toBe(200);
    const [before] = await db.select().from(clientInvoices).where(eq(clientInvoices.id, id));
    const again = await call("PATCH", depositPath(id), "admin", { depositedAt: "2026-02-01" });
    expect(again.status).toBe(200);
    const [after] = await db.select().from(clientInvoices).where(eq(clientInvoices.id, id));
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect((await call("PATCH", depositPath(id), "admin", { depositedAt: "2026-02-02" })).status).toBe(409);
  });

  it("dépôts concurrents : même date, deux 200 et un seul dépôt ; dates différentes, un 200 et un 409", async () => {
    const same = await newInvoice(await newClient("ht"));
    const twice = await Promise.all([
      call("PATCH", depositPath(same), "admin", { depositedAt: "2026-02-01" }),
      call("PATCH", depositPath(same), "secretary", { depositedAt: "2026-02-01" }),
    ]);
    expect(twice.map((r) => r.status)).toEqual([200, 200]);
    expect(twice[0].body).toEqual(twice[1].body);

    const other = await newInvoice(await newClient("ht"));
    const race = await Promise.all([
      call("PATCH", depositPath(other), "admin", { depositedAt: "2026-02-01" }),
      call("PATCH", depositPath(other), "secretary", { depositedAt: "2026-02-02" }),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = race.find((r) => r.status === 200)!;
    const [row] = await db.select().from(clientInvoices).where(eq(clientInvoices.id, other));
    expect(row.depositedAt).toBe(winner.body.depositedAt);
  });

  it("dépôt : le compte connecté est enregistré comme auteur", async () => {
    const id = await newInvoice(await newClient("ht"));
    expect((await call("PATCH", depositPath(id), "secretary", { depositedAt: "2026-02-01" })).status).toBe(200);
    const [row] = await db.select().from(clientInvoices).where(eq(clientInvoices.id, id));
    expect(row.depositedBy).toBe(userIds.get("secretary"));
  });

  it("date future ou antérieure à la facture : 400, rien n'est écrit", async () => {
    const id = await newInvoice(await newClient("ht"), { invoiceDate: "2026-01-15" });
    const tomorrow = isoDateInZone(new Date(Date.now() + 2 * 86400000));
    expect((await call("PATCH", depositPath(id), "admin", { depositedAt: tomorrow })).status).toBe(400);
    expect((await call("PATCH", depositPath(id), "admin", { depositedAt: "2026-01-14" })).status).toBe(400);
    const [row] = await db.select().from(clientInvoices).where(eq(clientInvoices.id, id));
    expect(row.depositedAt).toBeNull();
    expect(row.netPayable).toBeNull();
  });

  it("facture soldée : 409", async () => {
    const id = await newInvoice(await newClient("ht"), { status: "paid" });
    expect((await call("PATCH", depositPath(id), "admin", { depositedAt: "2026-02-01" })).status).toBe(409);
  });

  it.each([
    ["id 0", 0, 400],
    ["id hors plage", MAX_DB_INTEGER_ID + 1, 400],
    ["id non numérique", "abc", 400],
    ["facture inconnue", MAX_DB_INTEGER_ID, 404],
  ])("%s → %s", async (_label, id, status) => {
    expect((await call("PATCH", depositPath(id), "admin", { depositedAt: "2026-02-01" })).status).toBe(status);
  });

  it("corps invalide : 400", async () => {
    const id = await newInvoice(await newClient("ht"));
    expect((await call("PATCH", depositPath(id), "admin", { depositedAt: "01/02/2026" })).status).toBe(400);
    expect((await call("PATCH", depositPath(id), "admin", { depositedAt: "2026-02-01", netPayable: 1 })).status).toBe(400);
  });
});

describe("taux de retenue du client", () => {
  it("mêmes valeurs rejouées : 200 sans réécriture", async () => {
    const clientId = await newClient("ht");
    const again = await call("PATCH", withholdingPath(clientId), "secretary", { ...CNPCC, isBase: "ht" });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ clientId, ...CNPCC, isBase: "ht" });
  });

  it.each([
    ["taux > 100", { vatWithholdingRate: 101, isWithholdingRate: 2.2, isBase: "ht" }],
    ["base inconnue", { ...CNPCC, isBase: "tva" }],
    ["champ en trop", { ...CNPCC, isBase: "ht", name: "x" }],
    ["taux en chaîne", { vatWithholdingRate: "19.25", isWithholdingRate: 2.2, isBase: "ht" }],
  ])("%s : 400", async (_label, body) => {
    const client = await createTestClient();
    ids.clientIds.push(client.id);
    expect((await call("PATCH", withholdingPath(client.id), "admin", body)).status).toBe(400);
  });

  it("le compte connecté est enregistré comme auteur du changement", async () => {
    const client = await createTestClient();
    ids.clientIds.push(client.id);
    expect((await call("PATCH", withholdingPath(client.id), "admin", { ...CNPCC, isBase: "ttc" })).status).toBe(200);
    const [row] = await db.select().from(clients).where(eq(clients.id, client.id));
    expect(row.withholdingUpdatedBy).toBe(userIds.get("admin"));
  });

  it("client inconnu : 404 ; id hors plage : 400", async () => {
    expect((await call("PATCH", withholdingPath(MAX_DB_INTEGER_ID), "admin", { ...CNPCC, isBase: "ht" })).status).toBe(404);
    expect((await call("PATCH", withholdingPath(MAX_DB_INTEGER_ID + 1), "admin", { ...CNPCC, isBase: "ht" })).status).toBe(400);
  });
});

describe("fiche client /api/clients : taux de retenue réservés à la lecture finance", () => {
  const FINANCE_KEYS = ["withholdingVatRate", "withholdingIsRate", "withholdingIsBase", "withholdingUpdatedBy"];

  it.each(["technician", "driver"])("%s : liste et fiche sans les taux", async (role) => {
    const clientId = await newClient("ttc");
    const list = await call("GET", "/api/clients", role);
    expect(list.status).toBe(200);
    const inList = (list.body as Record<string, unknown>[]).find((c) => c.id === clientId);
    expect(inList).toBeDefined();
    const one = await call("GET", `/api/clients/${clientId}`, role);
    expect(one.status).toBe(200);
    for (const key of FINANCE_KEYS) {
      expect(inList).not.toHaveProperty(key);
      expect(one.body).not.toHaveProperty(key);
    }
  });

  it.each(["admin", "secretary", "management", "logistics"])("%s : fiche avec les taux", async (role) => {
    const clientId = await newClient("ttc");
    const one = await call("GET", `/api/clients/${clientId}`, role);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ withholdingIsBase: "ttc", withholdingUpdatedBy: userIds.get("secretary") });
  });
});
