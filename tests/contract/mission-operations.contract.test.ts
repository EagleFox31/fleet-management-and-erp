import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MISSION_OPERATIONS_PATH,
  missionOperationsResponseSchema,
} from "../../shared/contracts/mission-operations";
import { db } from "../../server/db";
import { clientInvoices, missionOperations, missions } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient, createTestClientInvoice, createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/** O1 : suivi des opérations clients (drapeau, rôles, contrat, upsert rejouable). */
process.env.FEATURE_FLAGS = "operations-tracking=on";

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
const users = new Map<string, number>();
let missionId = 0;
let clientId = 0;

async function login(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  users.set(role, user.id);
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
    headers: { "Content-Type": "application/json", ...(role ? { Cookie: cookies.get(role)! } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of ["admin", "logistics", "secretary", "management", "technician", "client"] as const) await login(role);
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  clientId = client.id;
  const [m] = await db
    .insert(missions)
    .values({
      orderNumber: uniqueTestToken("op"),
      clientId,
      pickupAddress: "Douala",
      deliveryAddress: "Bafoussam",
      createdBy: users.get("admin"),
    })
    .returning();
  missionId = m.id;
}, 180000);
afterAll(async () => {
  if (ids.clientInvoiceIds.length) await db.delete(clientInvoices).where(inArray(clientInvoices.id, ids.clientInvoiceIds));
  await db.delete(missions).where(eq(missions.id, missionId));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

const rowOf = async () => {
  const res = await call("GET", `${MISSION_OPERATIONS_PATH}?clientId=${clientId}`, "admin");
  expect(res.status).toBe(200);
  const parsed = missionOperationsResponseSchema.parse(res.body);
  return { parsed, row: parsed.rows.find((r) => r.missionId === missionId)! };
};

describe("suivi des opérations clients", { timeout: 120000 }, () => {
  it("lecture : 401 sans session, 403 hors rôles, 200 conforme au contrat", async () => {
    expect((await call("GET", MISSION_OPERATIONS_PATH)).status).toBe(401);
    for (const role of ["technician", "client"]) {
      expect((await call("GET", MISSION_OPERATIONS_PATH, role)).status).toBe(403);
    }
    for (const role of ["admin", "logistics", "secretary", "management"]) {
      expect((await call("GET", MISSION_OPERATIONS_PATH, role)).status).toBe(200);
    }
    expect((await call("GET", `${MISSION_OPERATIONS_PATH}?month=2026-13`, "admin")).status).toBe(400);
  });

  it("écriture : réservée à admin et logistique, corps strict, mission inconnue en 404", async () => {
    const path = `${MISSION_OPERATIONS_PATH}/${missionId}`;
    expect((await call("PUT", path, undefined, {})).status).toBe(401);
    for (const role of ["secretary", "management", "technician", "client"]) {
      expect((await call("PUT", path, role, { blNumber: "X" })).status).toBe(403);
    }
    expect((await call("PUT", path, "logistics", { createdBy: 1 })).status).toBe(400);
    expect((await call("PUT", path, "logistics", { loadingDate: "demain" })).status).toBe(400);
    expect((await call("PUT", `${MISSION_OPERATIONS_PATH}/99999999`, "logistics", { blNumber: "X" })).status).toBe(404);
  });

  it("upsert rejouable : une seule ligne, audit renseigné, effacement par null", async () => {
    const path = `${MISSION_OPERATIONS_PATH}/${missionId}`;
    const body = { containerNumber: "MSKU1234567", blNumber: "BL-1", loadingDate: "2026-03-01", departureDate: "2026-03-02", unloadingDate: "2026-03-06" };
    expect((await call("PUT", path, "logistics", body)).status).toBe(200);
    expect((await call("PUT", path, "logistics", body)).status).toBe(200);
    const stored = await db.select().from(missionOperations).where(eq(missionOperations.missionId, missionId));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ containerNumber: "MSKU1234567", createdBy: users.get("logistics"), updatedBy: users.get("logistics") });
    expect((await call("PUT", path, "admin", { blNumber: null })).status).toBe(200);
    const { row } = await rowOf();
    expect(row).toMatchObject({ containerNumber: "MSKU1234567", blNumber: null, recapStatus: "trip" });
  });

  it("remorque inconnue : 400 (pas de 500 par violation de FK)", async () => {
    const res = await call("PUT", `${MISSION_OPERATIONS_PATH}/${missionId}`, "logistics", { trailerVehicleId: 2147483000 });
    expect(res.status).toBe(400);
  });

  it("dates : relues à l'identique après chaque sauvegarde (pas de recul d'un jour)", async () => {
    const path = `${MISSION_OPERATIONS_PATH}/${missionId}`;
    for (let i = 0; i < 3; i++) {
      expect((await call("PUT", path, "logistics", { loadingDate: "2026-03-01", unloadingDate: "2026-03-06" })).status).toBe(200);
      const { row } = await rowOf();
      expect(row.loadingDate).toBe("2026-03-01T00:00:00Z");
      expect(row.unloadingDate).toBe("2026-03-06T00:00:00Z");
    }
  });

  it("récapitulatif : suit la facture liée (facturation, attente, payée)", async () => {
    await db.update(missions).set({ status: "delivered" }).where(eq(missions.id, missionId));
    expect((await rowOf()).row.recapStatus).toBe("invoicing");
    const inv = await createTestClientInvoice({ clientId, createdBy: users.get("admin") });
    ids.clientInvoiceIds.push(inv.id);
    await db.update(clientInvoices).set({ missionId }).where(eq(clientInvoices.id, inv.id));
    const waiting = await rowOf();
    expect(waiting.row).toMatchObject({ recapStatus: "awaiting_payment", invoiceNumber: inv.invoiceNumber });
    expect(waiting.parsed.recap.awaiting_payment).toBe(1);
    await db.update(clientInvoices).set({ status: "paid" }).where(eq(clientInvoices.id, inv.id));
    expect((await rowOf()).row.recapStatus).toBe("paid");
  });
});

describe("drapeau désactivé", () => {
  it("la route est introuvable (404) même pour l'admin", async () => {
    process.env.FEATURE_FLAGS = "";
    try {
      expect((await call("GET", MISSION_OPERATIONS_PATH, "admin")).status).toBe(404);
    } finally {
      process.env.FEATURE_FLAGS = "operations-tracking=on";
    }
  });
});
