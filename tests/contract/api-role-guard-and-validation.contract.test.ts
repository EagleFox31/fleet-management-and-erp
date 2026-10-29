import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { partRequirements, vehicles, workOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient, createTestPart, createTestSupplier, createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Niveau C, sessions réelles par rôle.
 * - T1 : un rôle non autorisé reçoit 403 au contrat d'erreur.
 * - T3 : un rôle autorisé qui envoie un corps invalide reçoit 400 avec un
 *   message lisible, jamais une 500 ni un détail technique.
 *
 * Les corps sont vides : aucune de ces requêtes ne doit écrire en base.
 */

type Case = { path: string; forbidden: TestUserRole; allowed: TestUserRole };

const CASES: Case[] = [
  { path: "/api/work-orders", forbidden: "technician", allowed: "workshop_manager" },
  { path: "/api/vehicles", forbidden: "technician", allowed: "workshop_manager" },
  { path: "/api/part-requirements", forbidden: "secretary", allowed: "technician" },
  { path: "/api/purchase-orders", forbidden: "technician", allowed: "warehouse" },
  { path: "/api/supplier-invoices", forbidden: "warehouse", allowed: "secretary" },
  { path: "/api/suppliers", forbidden: "technician", allowed: "secretary" },
  { path: "/api/clients", forbidden: "warehouse", allowed: "secretary" },
];

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<TestUserRole, string>();
const requirementIds: number[] = [];
const workOrderIds: number[] = [];

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
  expect(res.body.message.length).toBeGreaterThan(0);
  expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
  expect(JSON.stringify(res.body)).not.toMatch(/stack|at \S+:\d+|SQLSTATE|TypeError|violates|null value/);
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const roles = [...new Set(CASES.flatMap((c) => [c.forbidden, c.allowed]))];
  for (const role of roles) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    const res = await call("POST", "/api/auth/login", { body: { username: user.username, password: TEST_USER_PASSWORD } });
    expect(res.status).toBe(200);
    cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
  }
}, 120000);

afterAll(async () => {
  if (requirementIds.length > 0) {
    await db.delete(partRequirements).where(inArray(partRequirements.id, requirementIds));
  }
  if (workOrderIds.length > 0) {
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("T1 : 403 selon le rôle", { timeout: 60000 }, () => {
  it.each(CASES)("POST $path refusé au rôle $forbidden", async ({ path, forbidden }) => {
    const res = await call("POST", path, { cookie: cookies.get(forbidden), body: {} });
    expect(res.status).toBe(403);
    expectErrorContract(res, "FORBIDDEN");
  });
});

describe("T3 : 400 lisible sur corps invalide", { timeout: 60000 }, () => {
  it.each(CASES)("POST $path, corps vide, rôle $allowed", async ({ path, allowed }) => {
    const res = await call("POST", path, { cookie: cookies.get(allowed), body: {} });
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
  });
});

describe("non-régression : corps valide toujours accepté", { timeout: 60000 }, () => {
  it("POST /api/part-requirements avec la charge utile de l'écran inventaire", async () => {
    const part = await createTestPart();
    ids.partIds.push(part.id);
    const res = await call("POST", "/api/part-requirements", {
      cookie: cookies.get("technician"),
      body: { partId: part.id, quantityNeeded: 1, reason: "TEST demande valide", urgency: "medium", notes: "" },
    });
    expect(res.status).toBe(201);
    requirementIds.push(res.body.id);
    expect(res.body).toMatchObject({ partId: part.id, status: "pending" });
  });

  it("T4 : POST /api/part-requirements ignore le statut et la date de livraison du corps", async () => {
    const part = await createTestPart();
    ids.partIds.push(part.id);
    const res = await call("POST", "/api/part-requirements", {
      cookie: cookies.get("technician"),
      body: { partId: part.id, quantityNeeded: 1, reason: "TEST statut forcé", status: "issued", actualDeliveryDate: "2026-01-01" },
    });
    expect(res.status).toBe(201);
    requirementIds.push(res.body.id);
    expect(res.body).toMatchObject({ status: "pending", actualDeliveryDate: null });
  });
});

describe("T3 : 400 lisible sur PATCH de type invalide", { timeout: 60000 }, () => {
  // Chaque fixture est créée pour le cas ; le corps invalide ne doit rien modifier.
  type PatchCase = { name: string; role: TestUserRole; body: Record<string, unknown>; path: () => Promise<string> };

  const PATCH_CASES: PatchCase[] = [
    {
      name: "véhicule",
      role: "workshop_manager",
      body: { year: "deux mille" },
      path: async () => {
        const v = await createTestVehicle();
        ids.vehicleIds.push(v.id);
        return `/api/vehicles/${v.id}`;
      },
    },
    {
      name: "ordre de travail",
      role: "workshop_manager",
      body: { duration: "longtemps" },
      path: async () => {
        const v = await createTestVehicle();
        ids.vehicleIds.push(v.id);
        const [wo] = await db.insert(workOrders).values({ vehicleId: v.id, title: "TEST patch invalide", status: "pending" }).returning();
        workOrderIds.push(wo.id);
        return `/api/work-orders/${wo.id}`;
      },
    },
    {
      name: "fournisseur",
      role: "secretary",
      body: { paymentTerms: "trente" },
      path: async () => {
        const s = await createTestSupplier();
        ids.supplierIds.push(s.id);
        return `/api/suppliers/${s.id}`;
      },
    },
    {
      name: "client",
      role: "secretary",
      body: { paymentTerms: "trente" },
      path: async () => {
        const c = await createTestClient();
        ids.clientIds.push(c.id);
        return `/api/clients/${c.id}`;
      },
    },
  ];

  it.each(PATCH_CASES)("PATCH $name, type invalide, rôle $role", async ({ role, body, path }) => {
    const res = await call("PATCH", await path(), { cookie: cookies.get(role), body });
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
    // Actionnable : le champ en cause est nommé.
    expect(res.body.errors?.map((e: { field: string }) => e.field)).toContain(Object.keys(body)[0]);
  });
});

describe("non-régression : PATCH véhicule depuis le formulaire", { timeout: 60000 }, () => {
  it("dates laissées vides (\"\") : la modification est enregistrée et les dates vidées", async () => {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const res = await call("PATCH", `/api/vehicles/${v.id}`, {
      cookie: cookies.get("workshop_manager"),
      body: { brand: "TEST-MARQUE", year: "2021", purchaseDate: "", insuranceExpiry: "", notes: "" },
    });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(vehicles).where(eq(vehicles.id, v.id));
    expect(row).toMatchObject({ brand: "TEST-MARQUE", year: 2021, purchaseDate: null, insuranceExpiry: null });
  });
});

describe("non-régression : PATCH ordre de travail depuis l'écran détail", { timeout: 60000 }, () => {
  it("commencer puis terminer : statuts, dates et affectation enregistrés", async () => {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const [wo] = await db.insert(workOrders).values({ vehicleId: v.id, title: "TEST démarrer terminer", status: "pending" }).returning();
    workOrderIds.push(wo.id);
    const technicianId = ids.userIds[0];

    const start = await call("PATCH", `/api/work-orders/${wo.id}`, {
      cookie: cookies.get("workshop_manager"),
      body: { status: "in_progress", startDate: new Date().toISOString(), technicianId },
    });
    expect(start.status).toBe(200);

    const done = await call("PATCH", `/api/work-orders/${wo.id}`, {
      cookie: cookies.get("workshop_manager"),
      body: { status: "completed", endDate: new Date().toISOString() },
    });
    expect(done.status).toBe(200);

    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, wo.id));
    expect(row).toMatchObject({ status: "completed", technicianId });
    expect(row.startDate).toBeInstanceOf(Date);
    expect(row.endDate).toBeInstanceOf(Date);
  });
});
