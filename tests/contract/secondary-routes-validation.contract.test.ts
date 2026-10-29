import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { faultCatalog, fuelRecords, maintenanceSchedules, users, vehicleDocuments } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestFuelRecord, createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Niveau C, routes secondaires (T3 et T4) : planifications, documents,
 * carburant, utilisateurs, catalogue de pannes.
 * - un corps invalide reçoit 400 au contrat, champ nommé, sans rien écrire ;
 * - les champs serveur renvoyés par les écrans (id, createdAt...) sont ignorés ;
 * - le corps réellement envoyé par le formulaire est enregistré.
 */

const ROLES: TestUserRole[] = ["admin", "workshop_manager"];

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<TestUserRole, string>();
const sessionUserIds = new Map<TestUserRole, number>();
const scheduleIds: number[] = [];
const faultCatalogIds: number[] = [];

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
  expect(JSON.stringify(res.body)).not.toMatch(/stack|at \S+:\d+|SQLSTATE|TypeError|violates|null value|NaN/);
}

function expectFieldError(res: { status: number; body: any; headers: Headers }, field: string) {
  expect(res.status).toBe(400);
  expectErrorContract(res, "VALIDATION");
  expect(res.body.errors?.map((e: { field: string }) => e.field)).toContain(field);
}

async function newVehicleId() {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  return v.id;
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  for (const role of ROLES) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    sessionUserIds.set(role, user.id);
    const res = await call("POST", "/api/auth/login", { body: { username: user.username, password: TEST_USER_PASSWORD } });
    expect(res.status).toBe(200);
    cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
  }
}, 120000);

afterAll(async () => {
  if (scheduleIds.length > 0) {
    await db.delete(maintenanceSchedules).where(inArray(maintenanceSchedules.id, scheduleIds));
  }
  if (faultCatalogIds.length > 0) {
    await db.delete(faultCatalog).where(inArray(faultCatalog.id, faultCatalogIds));
  }
  // Documents : supprimés en cascade avec le véhicule.
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("PATCH planification de maintenance", { timeout: 60000 }, () => {
  async function createSchedule() {
    const [row] = await db
      .insert(maintenanceSchedules)
      .values({ vehicleId: await newVehicleId(), title: "TEST plan", frequency: "monthly", frequencyValue: 1 })
      .returning();
    scheduleIds.push(row.id);
    return row;
  }

  it("non-régression : l'édition depuis le formulaire (fiche entière) est enregistrée", async () => {
    const schedule = await createSchedule();
    const res = await call("PATCH", `/api/maintenance-schedules/${schedule.id}`, {
      cookie: cookies.get("workshop_manager"),
      body: { ...schedule, title: "TEST plan modifié", frequencyValue: 3, scheduledDate: "2026-12-01T00:00:00.000Z" },
    });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.id, schedule.id));
    expect(row.title).toBe("TEST plan modifié");
    expect(row.frequencyValue).toBe(3);
    expect(row.scheduledDate).toBe("2026-12-01");
    expect(row.createdAt).toEqual(schedule.createdAt);
  });

  it("non-régression : activation seule depuis l'écran préventif", async () => {
    const schedule = await createSchedule();
    const res = await call("PATCH", `/api/maintenance-schedules/${schedule.id}`, {
      cookie: cookies.get("workshop_manager"),
      body: { isActive: false },
    });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.id, schedule.id));
    expect(row.isActive).toBe(false);
    expect(row.title).toBe("TEST plan");
  });

  it("T3 : fréquence illisible -> 400 nommé, rien d'écrit", async () => {
    const schedule = await createSchedule();
    const res = await call("PATCH", `/api/maintenance-schedules/${schedule.id}`, {
      cookie: cookies.get("workshop_manager"),
      body: { frequencyValue: "souvent" },
    });
    expectFieldError(res, "frequencyValue");
    const [row] = await db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.id, schedule.id));
    expect(row.frequencyValue).toBe(1);
  });

  it("corps sans champ connu -> 400 au contrat, pas de 500", async () => {
    const schedule = await createSchedule();
    const res = await call("PATCH", `/api/maintenance-schedules/${schedule.id}`, { cookie: cookies.get("workshop_manager"), body: {} });
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
  });
});

describe("PATCH document de véhicule", { timeout: 60000 }, () => {
  async function createDocument() {
    const [row] = await db
      .insert(vehicleDocuments)
      .values({
        vehicleId: await newVehicleId(),
        name: "TEST doc",
        type: "autre",
        filename: "test.pdf",
        filesize: 1,
        fileType: "application/pdf",
        filePath: "uploads/test/test.pdf",
      })
      .returning();
    return row;
  }

  it("T3 : date d'expiration illisible -> 400 nommé (était un 404 trompeur)", async () => {
    const doc = await createDocument();
    const res = await call("PATCH", `/api/documents/${doc.id}`, { cookie: cookies.get("workshop_manager"), body: { expiryDate: "pas une date" } });
    expectFieldError(res, "expiryDate");
  });

  it("T3 : nom vidé -> 400 nommé, nom conservé", async () => {
    const doc = await createDocument();
    const res = await call("PATCH", `/api/documents/${doc.id}`, { cookie: cookies.get("workshop_manager"), body: { name: "  " } });
    expectFieldError(res, "name");
    const [row] = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, doc.id));
    expect(row.name).toBe("TEST doc");
  });
});

describe("carburant : nombres saisis", { timeout: 60000 }, () => {
  it("T3 : POST corps vide -> 400 au contrat (était une 500)", async () => {
    const res = await call("POST", "/api/fuel-records", { cookie: cookies.get("workshop_manager"), body: {} });
    expectFieldError(res, "cost");
  });

  it("T3 : POST quantité illisible -> 400 nommé, aucun plein créé", async () => {
    const vehicleId = await newVehicleId();
    const res = await call("POST", "/api/fuel-records", {
      cookie: cookies.get("workshop_manager"),
      body: { vehicleId, date: "2026-10-01", quantity: "beaucoup", cost: 1000, mileage: 10 },
    });
    expectFieldError(res, "quantity");
    const rows = await db.select().from(fuelRecords).where(eq(fuelRecords.vehicleId, vehicleId));
    expect(rows).toHaveLength(0);
  });

  it("T3 : PATCH \"12abc\" refusé au lieu d'être tronqué en 12", async () => {
    const record = await createTestFuelRecord({ vehicleId: await newVehicleId() });
    ids.fuelRecordIds.push(record.id);
    const res = await call("PATCH", `/api/fuel-records/${record.id}`, { cookie: cookies.get("workshop_manager"), body: { quantity: "12abc" } });
    expectFieldError(res, "quantity");
    const [row] = await db.select().from(fuelRecords).where(eq(fuelRecords.id, record.id));
    expect(row.quantity).toBe(record.quantity);
  });

  it("non-régression : PATCH quantité en chaîne numérique enregistrée", async () => {
    const record = await createTestFuelRecord({ vehicleId: await newVehicleId() });
    ids.fuelRecordIds.push(record.id);
    const res = await call("PATCH", `/api/fuel-records/${record.id}`, { cookie: cookies.get("workshop_manager"), body: { quantity: "25.5" } });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(fuelRecords).where(eq(fuelRecords.id, record.id));
    expect(row.quantity).toBe(25.5);
    expect(row.notes).toBe(record.notes);
  });
});

describe("PATCH utilisateur", { timeout: 60000 }, () => {
  it("T4 : la fiche entière renvoyée par l'écran est enregistrée, champs serveur ignorés", async () => {
    const target = await createTestUser({ role: "technician" });
    ids.userIds.push(target.id);
    const res = await call("PATCH", `/api/users/${target.id}`, {
      cookie: cookies.get("admin"),
      body: {
        id: 999999,
        username: target.username,
        email: target.email,
        name: "TEST-renommé",
        role: "technician",
        loginCount: 42,
        createdAt: "2001-01-01T00:00:00.000Z",
        lastLoginAt: null,
        password: "",
      },
    });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row.name).toBe("TEST-renommé");
    expect(row.loginCount).toBe(target.loginCount);
    expect(row.createdAt).toEqual(target.createdAt);
    expect(row.password).toBe(target.password);
  });

  it("T3 : rôle inconnu -> 400 nommé", async () => {
    const target = await createTestUser({ role: "technician" });
    ids.userIds.push(target.id);
    const res = await call("PATCH", `/api/users/${target.id}`, { cookie: cookies.get("admin"), body: { role: "pilote" } });
    expectFieldError(res, "role");
  });

  it("adresse e-mail déjà prise -> 409 lisible (était un 404 trompeur)", async () => {
    const a = await createTestUser({ role: "technician" });
    const b = await createTestUser({ role: "technician" });
    ids.userIds.push(a.id, b.id);
    const res = await call("PATCH", `/api/users/${b.id}`, { cookie: cookies.get("admin"), body: { email: a.email } });
    expect(res.status).toBe(409);
    expectErrorContract(res, "CONFLICT");
  });
});

describe("POST catalogue de pannes", { timeout: 60000 }, () => {
  it("T3 : corps vide -> 400 nommé (était une 500)", async () => {
    const res = await call("POST", "/api/fault-catalog", { cookie: cookies.get("workshop_manager"), body: {} });
    expectFieldError(res, "name");
  });

  it("T4 : createdBy vient de la session, validatedBy du corps ignoré", async () => {
    const other = sessionUserIds.get("admin")!;
    const res = await call("POST", "/api/fault-catalog", {
      cookie: cookies.get("workshop_manager"),
      body: { name: "TEST panne POST", description: "TEST", category: "TEST", symptoms: ["bruit"], createdBy: other, validatedBy: other },
    });
    expect(res.status).toBe(201);
    faultCatalogIds.push(res.body.id);
    const [row] = await db.select().from(faultCatalog).where(eq(faultCatalog.id, res.body.id));
    expect(row.createdBy).toBe(sessionUserIds.get("workshop_manager"));
    expect(row.validatedBy).toBeNull();
  });
});
