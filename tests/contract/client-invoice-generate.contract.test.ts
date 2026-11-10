import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { clientInvoices, missions } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient, createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { leakText } from "../support/api-error";
import { cleanupPodFiles, seedPodFile } from "../support/pod";

/**
 * Niveau C, facturation d'une mission (`POST /api/billing/invoices/generate`).
 * - T1 : rôle non autorisé -> 403.
 * - T3 : montant, mission ou échéance invalide -> 400 lisible, aucune facture.
 * - T4 : TVA et TTC recalculés par le serveur, montants client (TTC, solde, statut) ignorés.
 * - Mission inconnue -> 404 ; numéro de facture déjà pris -> 409 ; jamais de détail technique.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const missionIds: number[] = [];
const cookies = new Map<TestUserRole, string>();

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

function expectErrorContract(res: { body: any; headers: Headers }, code: string) {
  expect(res.body).toMatchObject({ code });
  expect(typeof res.body.message).toBe("string");
  expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
  expect(leakText(res.body)).not.toMatch(/stack|at \S+:\d+|SQLSTATE|TypeError|violates|NaN|duplicate key/);
}

/** Par défaut : mission livrée avec une preuve de livraison, donc facturable. */
async function newMission(options: { status?: "in_progress" | "delivered"; pod?: boolean } = {}) {
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  const [mission] = await db
    .insert(missions)
    .values({
      orderNumber: uniqueTestToken("mis"),
      clientId: client.id,
      pickupAddress: "Douala",
      deliveryAddress: "Yaoundé",
      status: options.status ?? "delivered",
    })
    .returning();
  missionIds.push(mission.id);
  if (options.pod !== false) await seedPodFile(mission.id, ids.userIds[0]);
  return mission;
}

function generate(body: Record<string, unknown>, role: TestUserRole = "secretary") {
  return call("POST", "/api/billing/invoices/generate", { cookie: cookies.get(role), body });
}

async function invoicesOf(missionId: number) {
  return db.select().from(clientInvoices).where(eq(clientInvoices.missionId, missionId));
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  for (const role of ["secretary", "technician"] as TestUserRole[]) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    const res = await call("POST", "/api/auth/login", { body: { username: user.username, password: TEST_USER_PASSWORD } });
    expect(res.status).toBe(200);
    cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
  }
}, 120000);

afterAll(async () => {
  await cleanupPodFiles(missionIds);
  if (missionIds.length > 0) {
    await db.delete(clientInvoices).where(inArray(clientInvoices.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("Facturation d'une mission : contrat", { timeout: 120000 }, () => {
  it("T1 : refusé au technicien", async () => {
    const mission = await newMission();
    const res = await generate({ missionId: mission.id, amount: 1000, dueDate: "2026-12-31" }, "technician");
    expect(res.status).toBe(403);
    expectErrorContract(res, "FORBIDDEN");
    expect(await invoicesOf(mission.id)).toHaveLength(0);
  });

  it.each([
    { label: "montant non numérique", body: { amount: "abc", dueDate: "2026-12-31" } },
    { label: "montant négatif", body: { amount: -5000, dueDate: "2026-12-31" } },
    { label: "montant hors bornes", body: { amount: 1e15, dueDate: "2026-12-31" } },
    { label: "échéance invalide", body: { amount: 1000, dueDate: "demain" } },
    { label: "échéance absente", body: { amount: 1000 } },
  ])("T3 : $label -> 400 lisible, aucune facture", async ({ body }) => {
    const mission = await newMission();
    const res = await generate({ missionId: mission.id, ...body });
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
    expect(await invoicesOf(mission.id)).toHaveLength(0);
  });

  it("T3 : identifiant de mission invalide -> 400 lisible", async () => {
    const res = await generate({ missionId: "12abc", amount: 1000, dueDate: "2026-12-31" });
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
  });

  it("mission inconnue -> 404 lisible", async () => {
    const res = await generate({ missionId: 2147483000, amount: 1000, dueDate: "2026-12-31" });
    expect(res.status).toBe(404);
    expectErrorContract(res, "NOT_FOUND");
  });

  it("T4 : TVA et TTC recalculés, montants envoyés par le client ignorés", async () => {
    const mission = await newMission();
    const res = await generate({
      missionId: mission.id,
      amount: 100000.004,
      dueDate: "2026-12-31",
      amountTTC: 1,
      balance: 0,
      vatAmount: 0,
      status: "paid",
      createdBy: 1,
    });
    expect(res.status).toBe(200);
    const [invoice] = await invoicesOf(mission.id);
    expect(invoice.amountHT).toBe("100000.00");
    expect(invoice.vatAmount).toBe("19250.00");
    expect(invoice.amountTTC).toBe("119250.00");
    expect(invoice.balance).toBe("119250.00");
    expect(invoice.status).toBe("pending");
    expect(invoice.createdBy).not.toBe(1);
  });

  it("T4 : sans TVA, TTC = HT", async () => {
    const mission = await newMission();
    const res = await generate({ missionId: mission.id, amount: 5000, dueDate: "2026-12-31", includeVAT: false });
    expect(res.status).toBe(200);
    const [invoice] = await invoicesOf(mission.id);
    expect(invoice.vatAmount).toBe("0.00");
    expect(invoice.amountTTC).toBe("5000.00");
  });

  it("numéro de facture déjà pris -> 409 lisible", async () => {
    const mission = await newMission();
    const invoiceNumber = uniqueTestToken("num");
    const first = await generate({ missionId: mission.id, amount: 1000, dueDate: "2026-12-31", invoiceNumber });
    expect(first.status).toBe(200);
    const second = await generate({ missionId: mission.id, amount: 1000, dueDate: "2026-12-31", invoiceNumber });
    expect(second.status).toBe(409);
    expectErrorContract(second, "CONFLICT");
    expect(await invoicesOf(mission.id)).toHaveLength(1);
  });

  it("sans preuve de livraison -> 409 lisible, aucune facture", async () => {
    const mission = await newMission({ pod: false });
    const res = await generate({ missionId: mission.id, amount: 1000, dueDate: "2026-12-31" });
    expect(res.status).toBe(409);
    expectErrorContract(res, "CONFLICT");
    expect(res.body.message).toContain("Preuve de livraison manquante");
    expect(await invoicesOf(mission.id)).toHaveLength(0);
  });

  it("mission non livrée (même avec un POD) -> 409 lisible, aucune facture", async () => {
    const mission = await newMission({ status: "in_progress" });
    const res = await generate({ missionId: mission.id, amount: 1000, dueDate: "2026-12-31" });
    expect(res.status).toBe(409);
    expectErrorContract(res, "CONFLICT");
    expect(res.body.message).toContain("n'est pas livrée");
    expect(await invoicesOf(mission.id)).toHaveLength(0);
  });
});
