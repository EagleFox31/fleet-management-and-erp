import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { maintenanceSchedules, users, vehicleDocumentTypes } from "../../shared/schema";
import { leakText } from "../support/api-error";
import { startContractSession } from "../support/contract-session";
import { createTestUser, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Lot R8 : six écritures passent par la brique `validateBody` et portent leur garde déclarée.
 *
 *  - POST /api/auth/pin-login : corps validé en type avant toute recherche de compte (même 400 pour
 *    un compte connu et un compte inconnu, pas d'oracle) ; les échecs d'authentification gardent leur code.
 *  - PATCH /api/admin/users/:id/toggle : admin seul, `isActive` booléen obligatoire.
 *  - POST /api/test-date-maintenance : corps validé, rôles inchangés.
 *  - POST /api/maintenance-schedules : atelier seul, champs serveur ignorés.
 *  - POST /api/vehicle-document-types, PATCH /api/vehicle-document-types/:code : admin seul.
 */
type Actor = "admin" | "workshop" | "technician" | "secretary";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const PIN = "4821";
const codes: string[] = [];
const scheduleIds: number[] = [];

beforeAll(async () => {
  session = await startContractSession({ admin: "admin", workshop: "workshop_manager", technician: "technician", secretary: "secretary" });
}, 120000);

afterAll(async () => {
  for (const code of codes) await db.delete(vehicleDocumentTypes).where(eq(vehicleDocumentTypes.code, code));
  for (const id of scheduleIds) await db.delete(maintenanceSchedules).where(eq(maintenanceSchedules.id, id));
  await session?.stop();
}, 120000);

function expectClean(res: { body: any }) {
  expect(typeof res.body.message).toBe("string");
  expect(typeof res.body.requestId).toBe("string");
  expect(leakText(res.body)).not.toMatch(/stack|SELECT|Error:|ZodError|issues|\$2[aby]\$/);
}

function expectValidation(res: { status: number; body: any }) {
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(res.body.code).toBe("VALIDATION");
  expect(Array.isArray(res.body.errors) && res.body.errors.length).toBeGreaterThan(0);
  for (const e of res.body.errors) expect(typeof e.field).toBe("string");
  expectClean(res);
}

async function newDriver() {
  const created = await createTestUser({ role: "driver" });
  session.ids.userIds.push(created.id);
  await db.update(users).set({ pin: await bcrypt.hash(PIN, 4) }).where(eq(users.id, created.id));
  return created;
}

const pinLogin = (body: unknown) => session.call("POST", "/api/auth/pin-login", { actor: null, body });

describe("R8 : POST /api/auth/pin-login", { timeout: 60000 }, () => {
  it("bon PIN : session ouverte", async () => {
    const driver = await newDriver();
    const res = await pinLogin({ userId: driver.id, pin: PIN });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.id).toBe(driver.id);
    expect(res.body.pin).toBeUndefined();
  });

  it("corps de mauvais type : 400 VALIDATION errors[], identique pour un compte connu et inconnu", async () => {
    const driver = await newDriver();
    const bodies = (userId: unknown) => [
      { userId, pin: { x: 1 } },
      { userId, pin: ["4", "8"] },
      { userId, pin: "" },
      { userId: "abc", pin: PIN },
      { userId: { id: 1 }, pin: PIN },
      { pin: PIN },
      {},
    ];
    for (const [i, known] of bodies(driver.id).entries()) {
      const a = await pinLogin(known);
      const b = await pinLogin(bodies(999999999)[i]);
      expectValidation(a);
      expectValidation(b);
      expect(a.status).toBe(b.status);
      expect(a.body.code).toBe(b.body.code);
    }
  });

  it("compte inconnu et PIN faux : même statut et même code, sans détail technique, sans session", async () => {
    const driver = await newDriver();
    const unknown = await pinLogin({ userId: 999999999, pin: PIN });
    const wrong = await pinLogin({ userId: driver.id, pin: "0000" });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.code).toBe(wrong.body.code);
    expect(unknown.headers.get("set-cookie")).toBeNull();
    expect(wrong.headers.get("set-cookie")).toBeNull();
    expectClean(unknown);
    expectClean(wrong);
    expect(leakText(wrong.body)).not.toContain(PIN);
  });

  it("userId en chaîne numérique et PIN numérique restent acceptés", async () => {
    const driver = await newDriver();
    const res = await pinLogin({ userId: String(driver.id), pin: Number(PIN) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

describe("R8 : PATCH /api/admin/users/:id/toggle", { timeout: 60000 }, () => {
  const toggle = (id: number, body: unknown, actor: Actor = "admin") => session.call("PATCH", `/api/admin/users/${id}/toggle`, { actor, body });

  it("corps invalide : 400 errors[], aucune désactivation", async () => {
    const target = await createTestUser({ role: "warehouse" });
    session.ids.userIds.push(target.id);
    for (const body of [{}, { isActive: "false" }, { isActive: 0 }, { isActive: null }]) {
      expectValidation(await toggle(target.id, body));
    }
    const [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row.deletedAt).toBeNull();
  });

  it("rôle non admin : 403", async () => {
    const target = await createTestUser({ role: "warehouse" });
    session.ids.userIds.push(target.id);
    for (const actor of ["workshop", "technician", "secretary"] as Actor[]) {
      const res = await toggle(target.id, { isActive: false }, actor);
      expect(res.status).toBe(403);
      expectClean(res);
    }
  });

  it("admin désactive puis réactive ; les champs envoyés en plus sont ignorés", async () => {
    const target = await createTestUser({ role: "warehouse" });
    session.ids.userIds.push(target.id);
    const off = await toggle(target.id, { isActive: false, role: "admin", id: 1, email: "x@y.z" });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(leakText(off.body)).not.toContain("$2");
    expect(off.body.user.password).toBeUndefined();
    expect(off.body.user.pin).toBeUndefined();
    let [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row.deletedAt).not.toBeNull();
    expect(row.role).toBe("warehouse");
    expect(row.email).toBe(target.email);
    const on = await toggle(target.id, { isActive: true });
    expect(on.status).toBe(200);
    [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row.deletedAt).toBeNull();
  });

  it("un admin ne se désactive pas lui-même (400, y compris avec un booléen mal typé)", async () => {
    const self = session.userId("admin");
    expect((await toggle(self, { isActive: false })).status).toBe(400);
    expect((await toggle(self, { isActive: "false" })).status).toBe(400);
    const [row] = await db.select().from(users).where(eq(users.id, self));
    expect(row.deletedAt).toBeNull();
  });
});

describe("R8 : POST /api/test-date-maintenance", { timeout: 60000 }, () => {
  const post = (body: unknown, actor: Actor = "admin") => session.call("POST", "/api/test-date-maintenance", { actor, body });

  it("corps invalide : 400 VALIDATION errors[]", async () => {
    expectValidation(await post({}));
    expectValidation(await post({ vehicleId: "1", alertType: "insurance" }));
    expectValidation(await post({ vehicleId: 1, alertType: "inconnu" }));
  });

  it("rôle hors renouvellement : 403 ; maintenance refusée au secrétariat", async () => {
    const vehicle = await createTestVehicle();
    session.ids.vehicleIds.push(vehicle.id);
    const refused = await post({ vehicleId: vehicle.id, alertType: "insurance" }, "technician");
    expect(refused.status).toBe(403);
    expectClean(refused);
    const maint = await post({ vehicleId: vehicle.id, alertType: "maintenance" }, "secretary");
    expect(maint.status).toBe(403);
  });

  it("véhicule inconnu : 404 lisible", async () => {
    const res = await post({ vehicleId: 999999999, alertType: "insurance" });
    expect(res.status).toBe(404);
    expectClean(res);
  });
});

describe("R8 : POST /api/maintenance-schedules", { timeout: 60000 }, () => {
  const post = (body: unknown, actor: Actor = "workshop") => session.call("POST", "/api/maintenance-schedules", { actor, body });
  const valid = (vehicleId: number) => ({
    vehicleId,
    title: `TEST-r8-${uniqueTestToken("s")}`,
    frequency: "monthly",
    frequencyValue: 1,
    scheduledDate: "2030-01-15",
    isActive: false,
  });

  it("corps invalide : 400 VALIDATION errors[]", async () => {
    const vehicle = await createTestVehicle();
    session.ids.vehicleIds.push(vehicle.id);
    expectValidation(await post({ ...valid(vehicle.id), frequency: "souvent" }));
    expectValidation(await post({ ...valid(vehicle.id), title: "" }));
    expectValidation(await post({}));
  });

  it("technicien et secrétariat refusés (403)", async () => {
    const vehicle = await createTestVehicle();
    session.ids.vehicleIds.push(vehicle.id);
    for (const actor of ["technician", "secretary"] as Actor[]) {
      const res = await post(valid(vehicle.id), actor);
      expect(res.status).toBe(403);
      expectClean(res);
    }
  });

  it("véhicule inconnu : 404", async () => {
    expect((await post(valid(999999999))).status).toBe(404);
  });

  it("champs serveur envoyés par le client : ignorés (id et createdAt posés par la base)", async () => {
    const vehicle = await createTestVehicle();
    session.ids.vehicleIds.push(vehicle.id);
    const res = await post({ ...valid(vehicle.id), id: 2147000000, createdAt: "2000-01-01T00:00:00.000Z", createdBy: 1, updatedBy: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    scheduleIds.push(res.body.id);
    expect(res.body.id).not.toBe(2147000000);
    const [row] = await db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.id, res.body.id));
    expect(row.id).not.toBe(2147000000);
    expect(row.createdAt.getFullYear()).toBeGreaterThan(2000);
    expect(row.vehicleId).toBe(vehicle.id);
  });
});

describe("R8 : /api/vehicle-document-types", { timeout: 60000 }, () => {
  const newCode = () => {
    const code = `test_r8_${uniqueTestToken("c").toLowerCase().replace(/[^a-z0-9]/g, "")}`.slice(0, 40);
    codes.push(code);
    return code;
  };
  const post = (body: unknown, actor: Actor = "admin") => session.call("POST", "/api/vehicle-document-types", { actor, body });
  const patch = (code: string, body: unknown, actor: Actor = "admin") => session.call("PATCH", `/api/vehicle-document-types/${code}`, { actor, body });

  it("POST : corps invalide 400 errors[], non admin 403", async () => {
    expectValidation(await post({ code: "X", label: "" }));
    expectValidation(await post({}));
    for (const actor of ["workshop", "secretary"] as Actor[]) {
      const res = await post({ code: newCode(), label: "Type test", validityMonths: null, alertDays: 10, active: true, sortOrder: 5 }, actor);
      expect(res.status).toBe(403);
      expectClean(res);
    }
  });

  it("POST : crée le type, ignore les champs inconnus, refuse un doublon (409)", async () => {
    const code = newCode();
    const res = await post({ code, label: "Type test", validityMonths: 6, createdAt: "2000-01-01", createdBy: 1, id: 7 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.createdAt).toBeUndefined();
    expect(res.body.id).toBeUndefined();
    const [row] = await db.select().from(vehicleDocumentTypes).where(eq(vehicleDocumentTypes.code, code));
    expect(row.label).toBe("Type test");
    expect(row.alertDays).toBe(30);
    expect((await post({ code, label: "Autre", validityMonths: null })).status).toBe(409);
  });

  it("PATCH : corps invalide 400, vide 400, non admin 403, inconnu 404", async () => {
    const code = newCode();
    expect((await post({ code, label: "Type test", validityMonths: null })).status).toBe(201);
    expectValidation(await patch(code, { alertDays: -1 }));
    expectValidation(await patch(code, {}));
    expect((await patch(code, { label: "Nouveau" }, "workshop")).status).toBe(403);
    expect((await patch("test_r8_inconnu", { label: "Nouveau" })).status).toBe(404);
  });

  it("PATCH : met à jour le libellé ; code et champs inconnus sont ignorés", async () => {
    const code = newCode();
    expect((await post({ code, label: "Type test", validityMonths: null })).status).toBe(201);
    const res = await patch(code, { label: "Nouveau libellé", code: "autre_code", createdBy: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.code).toBe(code);
    const [row] = await db.select().from(vehicleDocumentTypes).where(eq(vehicleDocumentTypes.code, code));
    expect(row.label).toBe("Nouveau libellé");
  });
});
