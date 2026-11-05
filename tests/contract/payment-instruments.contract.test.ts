import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isoDateInZone } from "../../shared/contracts/kpi-period";
import { PAYMENT_INSTRUMENTS_PATH, paymentInstrumentAlert } from "../../shared/contracts/payment-instruments";
import { TREASURY_BASE_PATH } from "../../shared/contracts/treasury";
import { db } from "../../server/db";
import { paymentInstruments, treasuryAccounts, treasuryEntries } from "../../shared/schema";
import { leakText, TECHNICAL } from "../support/api-error";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/** Lot T4 : traites et chèques (droits, échéances et alertes, paiement écrit au journal, rejeu). */
process.env.FEATURE_FLAGS = "finance=on";

const ids = createIdBag();
const cookies = new Map<string, string>();
const accountIds: number[] = [];
const instrumentIds: number[] = [];
const suffix = Date.now().toString(36).toUpperCase();
let server: Server;
let baseUrl = "";

const today = isoDateInZone(new Date());
function shift(days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function login(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
}
async function call(method: string, path: string, role?: string, body?: unknown) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { ...(role ? { Cookie: cookies.get(role)! } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* corps vide */
  }
  return { status: res.status, body: json };
}
async function newAccount(tag: string) {
  const res = await call("POST", `${TREASURY_BASE_PATH}/accounts`, "secretary", {
    code: `T4${suffix}${tag}`,
    label: `Compte ${tag}`,
    kind: "bank",
    openingBalance: "1000000.00",
  });
  expect(res.status).toBe(201);
  accountIds.push(res.body.id);
  return res.body as { id: number };
}
const draft = (tag: string, extra: Record<string, unknown> = {}) => ({
  kind: "traite",
  number: `TR-${suffix}-${tag}`,
  drawer: "CFAO MOBILITY",
  drawee: "TAY",
  payingBank: "SGC",
  amount: "2500000",
  issueDate: shift(-30),
  dueDate: shift(20),
  ...extra,
});
async function create(tag: string, extra: Record<string, unknown> = {}) {
  const res = await call("POST", PAYMENT_INSTRUMENTS_PATH, "secretary", draft(tag, extra));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  instrumentIds.push(res.body.id);
  return res.body;
}
const at = (id: number, rest = "") => `${PAYMENT_INSTRUMENTS_PATH}/${id}${rest}`;

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of ["admin", "secretary", "management", "technician", "client", "logistics"] as const) await login(role);
}, 180000);

afterAll(async () => {
  if (instrumentIds.length) await db.delete(paymentInstruments).where(inArray(paymentInstruments.id, instrumentIds));
  if (accountIds.length) {
    await db.delete(treasuryEntries).where(inArray(treasuryEntries.accountId, accountIds));
    await db.delete(treasuryAccounts).where(inArray(treasuryAccounts.id, accountIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("traites et chèques : droits", { timeout: 120000 }, () => {
  it("sans session 401 ; technicien, client et logistique 403 ; direction lit sans saisir", async () => {
    expect((await call("GET", PAYMENT_INSTRUMENTS_PATH)).status).toBe(401);
    for (const role of ["technician", "client", "logistics"]) {
      expect((await call("GET", PAYMENT_INSTRUMENTS_PATH, role)).status, role).toBe(403);
      expect((await call("POST", PAYMENT_INSTRUMENTS_PATH, role, draft("X"))).status, role).toBe(403);
    }
    expect((await call("GET", PAYMENT_INSTRUMENTS_PATH, "management")).status).toBe(200);
    expect((await call("POST", PAYMENT_INSTRUMENTS_PATH, "management", draft("M"))).status).toBe(403);
    expect((await call("POST", at(1, "/pay"), "management", { accountId: 1, paidAt: today })).status).toBe(403);
  });

  it("drapeau finance coupé : 404", async () => {
    const flags = process.env.FEATURE_FLAGS;
    delete process.env.FEATURE_FLAGS;
    try {
      expect((await call("GET", PAYMENT_INSTRUMENTS_PATH, "admin")).status).toBe(404);
      expect((await call("POST", PAYMENT_INSTRUMENTS_PATH, "admin", draft("F"))).status).toBe(404);
    } finally {
      process.env.FEATURE_FLAGS = flags;
    }
  });
});

describe("traites et chèques : saisie", { timeout: 120000 }, () => {
  it("création : en attente, sens par défaut « à payer », audit renseigné", async () => {
    const created = await create("C1");
    expect(created).toMatchObject({ status: "pending", direction: "outgoing", amount: "2500000.00", daysUntilDue: 20, alert: "none" });
    const [row] = await db.select().from(paymentInstruments).where(eq(paymentInstruments.id, created.id));
    expect(row.createdBy).not.toBeNull();
    expect(row.updatedBy).toBe(row.createdBy);
  });

  it("validation : échéance avant émission 400, champ inconnu 400, lien inexistant 422", async () => {
    expect((await call("POST", PAYMENT_INSTRUMENTS_PATH, "secretary", draft("V1", { dueDate: shift(-31) }))).status).toBe(400);
    expect((await call("POST", PAYMENT_INSTRUMENTS_PATH, "secretary", { ...draft("V2"), status: "paid" })).status).toBe(400);
    expect((await call("POST", PAYMENT_INSTRUMENTS_PATH, "secretary", draft("V3", { amount: "0" }))).status).toBe(400);
    const bad = await call("POST", PAYMENT_INSTRUMENTS_PATH, "secretary", draft("V4", { supplierId: 2_000_000_000 }));
    expect(bad.status).toBe(422);
    expect(leakText(bad.body)).not.toMatch(TECHNICAL);
  });

  it("rejeu : même clé et même contenu 200 sans doublon ; même clé, autre contenu 409", async () => {
    const key = `t4-${suffix}-k1`;
    const first = await call("POST", PAYMENT_INSTRUMENTS_PATH, "secretary", draft("K1", { requestKey: key }));
    expect(first.status).toBe(201);
    instrumentIds.push(first.body.id);
    const again = await call("POST", PAYMENT_INSTRUMENTS_PATH, "secretary", draft("K1", { requestKey: key }));
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    const other = await call("POST", PAYMENT_INSTRUMENTS_PATH, "secretary", draft("K1", { requestKey: key, amount: "1" }));
    expect(other.status).toBe(409);
    const rows = await db.select().from(paymentInstruments).where(eq(paymentInstruments.requestKey, key));
    expect(rows).toHaveLength(1);
  });

  it("correction : en attente seulement ; échéance avant émission 422", async () => {
    const p = await create("U1");
    const res = await call("PATCH", at(p.id), "secretary", { amount: "3000000", observations: "Avenant" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ amount: "3000000.00", observations: "Avenant" });
    expect((await call("PATCH", at(p.id), "secretary", { dueDate: shift(-40) })).status).toBe(422);
    expect((await call("PATCH", at(p.id), "secretary", {})).status).toBe(400);
    expect((await call("PATCH", at(p.id), "secretary", { status: "paid" })).status).toBe(400);
    expect((await call("POST", at(p.id, "/status"), "secretary", { status: "cancelled" })).status).toBe(200);
    expect((await call("PATCH", at(p.id), "secretary", { amount: "1" })).status).toBe(409);
    expect((await call("PATCH", at(2_000_000_000), "secretary", { amount: "1" })).status).toBe(404);
  });
});

describe("traites et chèques : paiement au journal", { timeout: 120000 }, () => {
  it("payée : écriture de sortie au journal, même transaction ; rejeu identique 200 ; autre paiement 409", async () => {
    const account = await newAccount("P");
    const p = await create("P1");
    const paid = await call("POST", at(p.id, "/pay"), "secretary", { accountId: account.id, paidAt: today });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body).toMatchObject({ replayed: false, instrument: { status: "paid", paidAt: today, paidAccountId: account.id, alert: "none" } });
    const [entry] = await db.select().from(treasuryEntries).where(eq(treasuryEntries.id, paid.body.instrument.treasuryEntryId));
    expect(entry).toMatchObject({
      accountId: account.id,
      direction: "out",
      amount: "2500000.00",
      category: "reglement_fournisseur",
      pieceRef: p.number,
      counterpartyLabel: "CFAO MOBILITY",
      requestKey: `instrument:${p.id}`,
    });
    const again = await call("POST", at(p.id, "/pay"), "secretary", { accountId: account.id, paidAt: today });
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(await db.select().from(treasuryEntries).where(eq(treasuryEntries.requestKey, `instrument:${p.id}`))).toHaveLength(1);
    expect((await call("POST", at(p.id, "/pay"), "secretary", { accountId: account.id, paidAt: shift(-1) })).status).toBe(409);
    expect((await call("POST", at(p.id, "/status"), "secretary", { status: "bounced" })).status).toBe(409);
  });

  it("à encaisser : écriture d'entrée, contrepartie = tiré", async () => {
    const account = await newAccount("I");
    const p = await create("I1", { kind: "cheque", direction: "incoming", drawer: "TAY", drawee: "CLIENT SA" });
    const paid = await call("POST", at(p.id, "/pay"), "secretary", { accountId: account.id, paidAt: today });
    expect(paid.status).toBe(200);
    const [entry] = await db.select().from(treasuryEntries).where(eq(treasuryEntries.id, paid.body.instrument.treasuryEntryId));
    expect(entry).toMatchObject({ direction: "in", category: "encaissement_client", counterpartyLabel: "CLIENT SA" });
  });

  it("paiements concurrents : une seule écriture", async () => {
    const account = await newAccount("R");
    const p = await create("R1");
    const results = await Promise.all(
      [0, 1, 2].map(() => call("POST", at(p.id, "/pay"), "secretary", { accountId: account.id, paidAt: today })),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(results.filter((r) => r.body.replayed === false)).toHaveLength(1);
    expect(await db.select().from(treasuryEntries).where(eq(treasuryEntries.requestKey, `instrument:${p.id}`))).toHaveLength(1);
  });

  it("refus : compte désactivé 409, compte inconnu 404, paiement avant émission 422, échéance annulée 409", async () => {
    const account = await newAccount("D");
    await db.update(treasuryAccounts).set({ isActive: false }).where(eq(treasuryAccounts.id, account.id));
    const p = await create("D1");
    expect((await call("POST", at(p.id, "/pay"), "secretary", { accountId: account.id, paidAt: today })).status).toBe(409);
    expect((await call("POST", at(p.id, "/pay"), "secretary", { accountId: 2_000_000_000, paidAt: today })).status).toBe(404);
    expect((await call("POST", at(p.id, "/pay"), "secretary", { accountId: account.id, paidAt: shift(-31) })).status).toBe(422);
    const [row] = await db.select().from(paymentInstruments).where(eq(paymentInstruments.id, p.id));
    expect(row).toMatchObject({ status: "pending", treasuryEntryId: null, paidAt: null });
    expect((await call("POST", at(p.id, "/status"), "secretary", { status: "cancelled" })).status).toBe(200);
    expect((await call("POST", at(p.id, "/status"), "secretary", { status: "cancelled" })).body.replayed).toBe(true);
    expect((await call("POST", at(p.id, "/pay"), "secretary", { accountId: accountIds[0], paidAt: today })).status).toBe(409);
  });

  it("la base refuse « payée » sans écriture (payment_instruments_paid_check)", async () => {
    const p = await create("Z1");
    await expect(
      db.update(paymentInstruments).set({ status: "paid", paidAt: today }).where(eq(paymentInstruments.id, p.id)),
    ).rejects.toThrow();
  });
});

describe("traites et chèques : échéances et alertes", { timeout: 120000 }, () => {
  it("jours avant échéance et alerte calculés à la date de Douala, conformes à l'oracle", async () => {
    const overdue = await create("A1", { dueDate: shift(-2) });
    const soon = await create("A2", { dueDate: shift(3) });
    const edge = await create("A3", { dueDate: shift(7) });
    const far = await create("A4", { dueDate: shift(8) });
    const res = await call("GET", `${PAYMENT_INSTRUMENTS_PATH}?status=pending`, "management");
    expect(res.status).toBe(200);
    expect(res.body.alertDays).toBe(7);
    const byId = new Map<number, any>(res.body.items.map((i: any) => [i.id, i]));
    for (const [p, days] of [[overdue, -2], [soon, 3], [edge, 7], [far, 8]] as const) {
      const item = byId.get(p.id);
      expect(item.daysUntilDue).toBe(days);
      expect(item.alert).toBe(paymentInstrumentAlert("pending", days, 7));
    }
    const wider = await call("GET", `${PAYMENT_INSTRUMENTS_PATH}?status=pending&alertDays=10`, "management");
    expect(wider.body.items.find((i: any) => i.id === far.id).alert).toBe("due_soon");
    expect((await call("GET", `${PAYMENT_INSTRUMENTS_PATH}?alertDays=999`, "management")).status).toBe(400);
  });

  it("totaux sommés en SQL sur la sélection filtrée", async () => {
    const res = await call("GET", `${PAYMENT_INSTRUMENTS_PATH}?status=pending`, "admin");
    const items = res.body.items as { amount: string; alert: string; status: string }[];
    const cents = (xs: { amount: string }[]) => xs.reduce((s, x) => s + Math.round(Number(x.amount) * 100), 0);
    const fmt = (c: number) => (c / 100).toFixed(2);
    expect(res.body.totals).toMatchObject({
      count: items.length,
      pendingCount: items.length,
      pendingAmount: fmt(cents(items)),
      overdueCount: items.filter((i) => i.alert === "overdue").length,
      overdueAmount: fmt(cents(items.filter((i) => i.alert === "overdue"))),
      dueSoonCount: items.filter((i) => i.alert === "due_soon").length,
      dueSoonAmount: fmt(cents(items.filter((i) => i.alert === "due_soon"))),
    });
    expect(items.every((i) => i.status === "pending")).toBe(true);
  });
});
