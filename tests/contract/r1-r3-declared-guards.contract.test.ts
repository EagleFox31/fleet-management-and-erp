import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { workOrders } from "../../shared/schema";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { leakText, messageText } from "../support/api-error";
import { startContractSession } from "../support/contract-session";

/**
 * Lot R1 + R3 (#238) : gardes déclarées sur la route et corps validé par `validateBody`.
 *
 *  - R3 : un rôle hors périmètre reçoit 403 de la garde, avant le handler. Le rôle admis passe
 *    la garde : la réponse n'est pas un 403, quel que soit le verdict du handler.
 *  - R1 : un corps invalide reçoit 400, code VALIDATION, `errors[]` par champ, sans détail technique.
 */
let session: Awaited<ReturnType<typeof startContractSession<"technician" | "manager" | "client" | "secretary" | "admin">>>;

// `POST /api/incidents` est derrière le drapeau `incidents` : éteint, la route répond 404 avant la garde.
const previousFlags = process.env.FEATURE_FLAGS;

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "incidents=on";
  session = await startContractSession({
    technician: "technician",
    manager: "workshop_manager",
    client: "client",
    secretary: "secretary",
    admin: "admin",
  });
}, 120000);

afterAll(async () => {
  await session?.stop();
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
});

describe("R3 : garde déclarée, 403 pour un rôle hors périmètre", { timeout: 120000 }, () => {
  const cases = [
    { route: "POST /api/document-renewals/requests", denied: "technician", allowed: "secretary", body: {} },
    { route: "PATCH /api/document-renewals/requests/999999999/status", denied: "technician", allowed: "secretary", body: { status: "approved" } },
    // Déclaration réservée au chauffeur et à l'admin (#637) : le technicien est refusé lui aussi.
    { route: "POST /api/incidents", denied: "technician", allowed: "admin", body: {} },
    { route: "PATCH /api/technician/work-orders/999999999/status", denied: "manager", allowed: "technician", body: { status: "in_progress" } },
  ] as const;

  for (const { route, denied, allowed, body } of cases) {
    it(`${route} : ${denied} refusé, ${allowed} passe la garde`, async () => {
      const [method, path] = route.split(" ");
      const refused = await session.call(method, path, { actor: denied, body });
      expect(refused.status).toBe(403);
      expect(typeof refused.body.message).toBe("string");
      expect(leakText(refused.body)).not.toMatch(/stack|SELECT|Error:/);

      const passed = await session.call(method, path, { actor: allowed, body });
      expect(passed.status, JSON.stringify(passed.body)).not.toBe(403);
    });
  }

  it("POST /api/invoices/calculate-vat n'existe plus", async () => {
    const res = await session.call("POST", "/api/invoices/calculate-vat", { actor: "secretary", body: {} });
    expect(res.status).toBe(404);
  });
});

describe("Statut d'OT par la route technicien : comportement de main inchangé", { timeout: 120000 }, () => {
  // Le handler exige déjà `role === "technician"` (lu en base) puis l'affectation à l'OT : la garde
  // déclarée ne retire aucun droit. Un admin ou un chef inscrit comme technicianId était déjà refusé.
  const created: number[] = [];
  let vehicleId: number;
  const workOrderFor = async (technicianId: number | null) => {
    const [row] = await db
      .insert(workOrders)
      .values({ vehicleId, technicianId, title: uniqueTestToken("ot-r3"), status: "pending", priority: "medium" })
      .returning();
    created.push(row.id);
    return row.id;
  };

  beforeAll(async () => {
    const vehicle = await createTestVehicle();
    session.ids.vehicleIds.push(vehicle.id);
    vehicleId = vehicle.id;
  });

  afterAll(async () => {
    if (created.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, created));
  });

  it("technicien affecté : passe ; technicien non affecté : 403", async () => {
    const own = await workOrderFor(session.userId("technician"));
    const other = await workOrderFor(session.userId("manager"));
    const ok = await session.call("PATCH", `/api/technician/work-orders/${own}/status`, { actor: "technician", body: { status: "in_progress" } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const refused = await session.call("PATCH", `/api/technician/work-orders/${other}/status`, { actor: "technician", body: { status: "in_progress" } });
    expect(refused.status).toBe(403);
  });

  it("chef d'atelier ou admin inscrit comme technicianId : 403, comme sur main", async () => {
    for (const actor of ["manager", "admin"] as const) {
      const wo = await workOrderFor(session.userId(actor));
      const res = await session.call("PATCH", `/api/technician/work-orders/${wo}/status`, { actor, body: { status: "in_progress" } });
      expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(403);
    }
  });
});

describe("R1 : corps invalide, 400 errors[] par champ", { timeout: 120000 }, () => {
  const cases = [
    { route: "POST /api/users/change-password", body: { currentPassword: 1 } },
    { route: "PATCH /api/onboarding/step", body: { step: "x" } },
    { route: "PATCH /api/onboarding/mascot", body: { mascot: 42 } },
    { route: "PATCH /api/notifications/settings", body: [{ topic: "inconnu", inApp: "oui" }] },
  ] as const;

  for (const { route, body } of cases) {
    it(`${route} : 400 VALIDATION lisible`, async () => {
      const [method, path] = route.split(" ");
      const res = await session.call(method, path, { actor: "technician", body });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.code).toBe("VALIDATION");
      expect(Array.isArray(res.body.errors) && res.body.errors.length).toBeGreaterThan(0);
      for (const e of res.body.errors) expect(typeof e.field).toBe("string");
      expect(typeof res.body.requestId).toBe("string");
      expect(messageText(res.body)).not.toMatch(/zod|issues|\{/i);
    });
  }
});
