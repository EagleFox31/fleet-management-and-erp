import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PENDING_INVOICES_PATH, pendingInvoicesResponseSchema, type PendingInvoice } from "../../shared/contracts/pending-invoices";
import { clientInvoices, missions } from "../../shared/schema";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { deleteClientInvoicesWhere } from "../support/money-override";

/**
 * Niveau C, P-21 : contenu de `GET /api/billing/pending-invoices`, ce qui reste à facturer par client.
 * Les droits et le drapeau restent à `aggregate-reads` : un seul rôle ici. La route lit toute la base,
 * les assertions ne portent que sur les clients créés par ce fichier.
 */
const previousFlags = process.env.FEATURE_FLAGS;
process.env.FEATURE_FLAGS = "pending-invoices=on";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();
const missionIds: number[] = [];
const invoiceIds: number[] = [];
let clientA = 0;
let clientB = 0;
let clientC = 0;
let clientD = 0;
let clientAName = "";

async function pending(): Promise<PendingInvoice[]> {
  const res = await fetch(`${baseUrl}${PENDING_INVOICES_PATH}`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const parsed = pendingInvoicesResponseSchema.safeParse(await res.json());
  expect(parsed.success).toBe(true);
  return parsed.data!;
}

type MissionSeed = { clientId: number | null; status: (typeof missions.$inferInsert)["status"]; completedAt?: Date; deliveryDate?: Date; agreedPrice?: string };

async function seedMission(m: MissionSeed): Promise<number> {
  const [row] = await db
    .insert(missions)
    .values({
      clientId: m.clientId,
      orderNumber: uniqueTestToken("pinv"),
      pickupAddress: "Douala",
      deliveryAddress: "Yaoundé",
      status: m.status,
      completedAt: m.completedAt,
      deliveryDate: m.deliveryDate,
      agreedPrice: m.agreedPrice,
    })
    .returning({ id: missions.id });
  missionIds.push(row.id);
  return row.id;
}

async function invoice(clientId: number, missionId: number, status: (typeof clientInvoices.$inferInsert)["status"]) {
  const [row] = await db
    .insert(clientInvoices)
    .values({
      clientId,
      missionId,
      invoiceNumber: uniqueTestToken("pinv-f"),
      invoiceDate: "2003-04-01",
      dueDate: "2099-01-01",
      amountHT: "1000",
      vatAmount: "192.5",
      amountTTC: "1192.5",
      balance: status === "paid" ? "0" : "1192.5",
      status,
    })
    .returning({ id: clientInvoices.id });
  invoiceIds.push(row.id);
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  const user = await createTestUser({ role: "admin" });
  ids.userIds.push(user.id);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];

  const [ca, cb, cc, cd] = [await createTestClient(), await createTestClient(), await createTestClient(), await createTestClient()];
  ids.clientIds.push(ca.id, cb.id, cc.id, cd.id);
  [clientA, clientB, clientC, clientD] = [ca.id, cb.id, cc.id, cd.id];
  clientAName = ca.name;

  // Client A : trois opérations à facturer.
  await seedMission({ clientId: clientA, status: "completed", completedAt: at("2003-02-10"), agreedPrice: "250000" });
  // Livrée sans date de fin : la date de livraison sert de date d'opération.
  await seedMission({ clientId: clientA, status: "delivered", deliveryDate: at("2003-01-20") });
  // Facture annulée : l'opération redevient à facturer.
  const cancelledInvoice = await seedMission({ clientId: clientA, status: "completed", completedAt: at("2003-03-01"), agreedPrice: "125000" });
  await invoice(clientA, cancelledInvoice, "cancelled");
  // Exclues : facture active (en attente, payée), mission non terminée ou annulée.
  const pendingInvoice = await seedMission({ clientId: clientA, status: "completed", completedAt: at("2002-01-01"), agreedPrice: "900000" });
  await invoice(clientA, pendingInvoice, "pending");
  const paidInvoice = await seedMission({ clientId: clientA, status: "delivered", completedAt: at("2002-01-02"), agreedPrice: "800000" });
  await invoice(clientA, paidInvoice, "paid");
  await seedMission({ clientId: clientA, status: "in_progress", completedAt: at("2002-01-03"), agreedPrice: "700000" });
  await seedMission({ clientId: clientA, status: "cancelled", completedAt: at("2002-01-04"), agreedPrice: "600000" });

  // Client B : une opération, plus ancienne que celles de A.
  await seedMission({ clientId: clientB, status: "completed", completedAt: at("2002-12-31"), agreedPrice: "0" });

  // Client C : tout est facturé (facture partiellement réglée comprise).
  const partial = await seedMission({ clientId: clientC, status: "completed", completedAt: at("2003-01-05") });
  await invoice(clientC, partial, "partial");

  // Client D : une seule opération, sans prix convenu.
  await seedMission({ clientId: clientD, status: "completed", completedAt: at("2002-11-30") });

  // Mission terminée sans client : ignorée, sans faire échouer la lecture.
  await seedMission({ clientId: null, status: "completed", completedAt: at("2002-06-01") });
});

afterAll(async () => {
  if (invoiceIds.length > 0) await deleteClientInvoicesWhere(inArray(clientInvoices.id, invoiceIds));
  if (missionIds.length > 0) await db.delete(missions).where(inArray(missions.id, missionIds));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
  process.env.FEATURE_FLAGS = previousFlags;
});

describe("GET /api/billing/pending-invoices : contenu", () => {
  it("compte par client les missions terminées ou livrées sans facture active", async () => {
    const rows = await pending();
    const a = rows.find((r) => r.clientId === clientA);
    expect(a).toMatchObject({ operationCount: 3, oldestOperationDate: "2003-01-20" });
    expect(rows.find((r) => r.clientId === clientB)).toMatchObject({ operationCount: 1, oldestOperationDate: "2002-12-31" });
  });

  // Le montant porte désormais des prix : valeurs vérifiées ci-dessous, y compris les cas sans prix et à zéro.
  it("amount somme les prix convenus des seules opérations à facturer (facture annulée comprise, facture active exclue)", async () => {
    const a = (await pending()).find((r) => r.clientId === clientA);
    expect(a?.amount).toBe(375000);
  });

  it("une opération sans prix n'est pas valorisée à 0 : elle est comptée à part", async () => {
    const rows = await pending();
    expect(rows.find((r) => r.clientId === clientA)?.missionsWithoutPrice).toBe(1);
    expect(rows.find((r) => r.clientId === clientD)).toMatchObject({ operationCount: 1, amount: 0, missionsWithoutPrice: 1 });
  });

  it("un prix convenu à 0 est un prix : non signalé sans prix", async () => {
    expect((await pending()).find((r) => r.clientId === clientB)).toMatchObject({ amount: 0, missionsWithoutPrice: 0 });
  });

  it("un client dont toutes les opérations sont facturées n'apparaît pas", async () => {
    const rows = await pending();
    expect(rows.some((r) => r.clientId === clientC)).toBe(false);
  });

  it("une ligne par client, nom du client joint, plus ancienne opération en tête", async () => {
    const rows = await pending();
    expect(rows.filter((r) => r.clientId === clientA)).toHaveLength(1);
    const mine = rows.filter((r) => r.clientId === clientA || r.clientId === clientB).map((r) => r.clientId);
    expect(mine).toEqual([clientB, clientA]);
    expect(rows.find((r) => r.clientId === clientA)?.clientName).toBe(clientAName);
  });
});
