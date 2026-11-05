import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { clientPayments } from "../../shared/schema";
import { MAX_DB_INTEGER_ID } from "../../shared/contracts/common";
import { clientStatementPath, clientStatementResponseSchema } from "../../shared/contracts/client-statement";
import { OUT_OF_SCOPE_MESSAGE } from "../../server/lib/client-scope";
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
 * GET /api/clients/:id/statement : relevé de compte client.
 * - Rôles : lecture finance (admin, management, secretary, logistics) ; autres profils 403 ;
 *   compte client 403 hors périmètre (aucune fiche client ne lui est rattachée).
 * - Calcul : débit TTC des factures, crédit des paiements, solde courant, ouverture à la veille de `from`,
 *   factures annulées exclues avec leurs paiements.
 * Écrit en base ; tout est supprimé (clients, factures, paiements en cascade).
 */
process.env.FEATURE_FLAGS = "finance=on";

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();

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

async function get(path: string, role?: string) {
  const headers: Record<string, string> = {};
  if (role) headers.Cookie = cookies.get(role)!;
  const res = await fetch(baseUrl + path, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function invoice(clientId: number, invoiceDate: string, amountTTC: string, status: "pending" | "cancelled" = "pending") {
  const row = await createTestClientInvoice({ clientId, invoiceDate, amountTTC, balance: amountTTC, status });
  ids.clientInvoiceIds.push(row.id);
  return row;
}

async function payment(invoiceId: number, paymentDate: string, amount: string, reference: string | null = null) {
  await db.insert(clientPayments).values({ invoiceId, paymentDate, amount, paymentMethod: "bank_transfer", reference });
}

let clientId = 0;
let emptyClientId = 0;
let inv1 = 0;
let inv2 = 0;

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of ["admin", "management", "secretary", "logistics", "technician", "driver", "client"] as const) await login(role);

  const client = await createTestClient();
  ids.clientIds.push(client.id);
  clientId = client.id;
  const empty = await createTestClient();
  ids.clientIds.push(empty.id);
  emptyClientId = empty.id;

  // Janvier : facture 1 (100 000), payée 40 000 en février.
  inv1 = (await invoice(clientId, "2026-01-10", "100000.00")).id;
  await payment(inv1, "2026-02-05", "40000.00", "VIR-001");
  // Mars : facture 2 (50 000) et paiement de 60 000 le même jour (facture listée avant le paiement).
  inv2 = (await invoice(clientId, "2026-03-01", "50000.00")).id;
  await payment(inv2, "2026-03-01", "60000.00", "CHQ-77");
  // Facture annulée et son paiement : hors relevé.
  const cancelled = await invoice(clientId, "2026-02-20", "999999.00", "cancelled");
  await payment(cancelled.id, "2026-02-21", "1000.00");
}, 180000);

afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("droits", () => {
  it("sans session : 401", async () => {
    expect((await get(clientStatementPath(clientId))).status).toBe(401);
  });

  it("compte client : 403 hors périmètre, même message pour un id absent", async () => {
    const own = await get(clientStatementPath(clientId), "client");
    const absent = await get(clientStatementPath(MAX_DB_INTEGER_ID), "client");
    expect(own.status).toBe(403);
    expect(own.body.message).toBe(OUT_OF_SCOPE_MESSAGE);
    expect(absent.status).toBe(403);
    expect(absent.body.message).toBe(OUT_OF_SCOPE_MESSAGE);
  });

  it.each(["technician", "driver"])("%s : 403 (relevé réservé aux profils finance)", async (role) => {
    expect((await get(clientStatementPath(clientId), role)).status).toBe(403);
  });

  it.each(["admin", "management", "secretary", "logistics"])("%s : 200 au contrat", async (role) => {
    const r = await get(clientStatementPath(clientId), role);
    expect(r.status).toBe(200);
    clientStatementResponseSchema.parse(r.body);
  });

  it("fiche client réduite à id et nom : aucun taux de retenue", async () => {
    const r = await get(clientStatementPath(clientId), "admin");
    expect(Object.keys(r.body.client).sort()).toEqual(["id", "name"]);
  });
});

describe("paramètres", () => {
  it("id non strict ou hors bornes : 400 ; client inconnu : 404", async () => {
    expect((await get(clientStatementPath("12abc"), "admin")).status).toBe(400);
    expect((await get(clientStatementPath("0"), "admin")).status).toBe(400);
    expect((await get(clientStatementPath(MAX_DB_INTEGER_ID), "admin")).status).toBe(404);
  });

  it.each([
    ["from=2026-03-01&to=2026-02-01", "La date de début doit précéder la date de fin."],
    ["from=2026-02-30", "Cette date n'existe pas au calendrier."],
    ["to=demain", "Date attendue au format AAAA-MM-JJ."],
    ["from[]=2026-01-01", "Période invalide."],
  ])("période invalide (%s) : 400, message lisible, aucun détail technique", async (query, message) => {
    const r = await get(`${clientStatementPath(clientId)}?${query}`, "admin");
    expect(r.status).toBe(400);
    expect(r.body.message).toBe(message);
    expect(typeof r.body.requestId).toBe("string");
    expect(JSON.stringify(r.body)).not.toMatch(/Expected|received|zod|stack|issues/i);
  });
});

describe("calcul", () => {
  it("tout l'historique : lignes ordonnées, solde courant, annulée exclue", async () => {
    const r = await get(`${clientStatementPath(clientId)}?to=2026-12-31`, "admin");
    const s = clientStatementResponseSchema.parse(r.body);
    expect(s.from).toBeNull();
    expect(s.openingBalance).toBe(0);
    expect(s.lines.map((l) => [l.date, l.kind, l.invoiceId, l.debit, l.credit, l.balance])).toEqual([
      ["2026-01-10", "invoice", inv1, 100000, 0, 100000],
      ["2026-02-05", "payment", inv1, 0, 40000, 60000],
      ["2026-03-01", "invoice", inv2, 50000, 0, 110000],
      ["2026-03-01", "payment", inv2, 0, 60000, 50000],
    ]);
    expect(s.lines[1]).toMatchObject({ reference: "VIR-001", paymentMethod: "bank_transfer" });
    expect(s.lines[0]).toMatchObject({ reference: null, paymentMethod: null });
    expect(s.totals).toEqual({ debit: 150000, credit: 100000 });
    expect(s.closingBalance).toBe(50000);
  });

  it("période : ouverture à la veille de from, lignes après to exclues", async () => {
    const r = await get(`${clientStatementPath(clientId)}?from=2026-02-01&to=2026-02-28`, "admin");
    const s = clientStatementResponseSchema.parse(r.body);
    expect(s.openingBalance).toBe(100000);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]).toMatchObject({ kind: "payment", credit: 40000, balance: 60000 });
    expect(s.totals).toEqual({ debit: 0, credit: 40000 });
    expect(s.closingBalance).toBe(60000);
  });

  it("bornes inclusives : un mouvement le jour de from et un le jour de to", async () => {
    const r = await get(`${clientStatementPath(clientId)}?from=2026-02-05&to=2026-03-01`, "admin");
    const s = clientStatementResponseSchema.parse(r.body);
    expect(s.openingBalance).toBe(100000);
    expect(s.lines.map((l) => [l.date, l.kind, l.balance])).toEqual([
      ["2026-02-05", "payment", 60000],
      ["2026-03-01", "invoice", 110000],
      ["2026-03-01", "payment", 50000],
    ]);
    expect(s.closingBalance).toBe(50000);
  });

  it("période sans mouvement : solde de clôture = ouverture", async () => {
    const r = await get(`${clientStatementPath(clientId)}?from=2026-06-01&to=2026-06-30`, "admin");
    const s = clientStatementResponseSchema.parse(r.body);
    expect(s.lines).toEqual([]);
    expect(s.openingBalance).toBe(50000);
    expect(s.closingBalance).toBe(50000);
  });

  it("client sans facture : relevé vide, to par défaut renseigné", async () => {
    const r = await get(clientStatementPath(emptyClientId), "secretary");
    const s = clientStatementResponseSchema.parse(r.body);
    expect(s.lines).toEqual([]);
    expect(s.closingBalance).toBe(0);
    expect(s.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
