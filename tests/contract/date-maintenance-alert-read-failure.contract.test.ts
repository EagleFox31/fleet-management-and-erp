import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { alerts } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";

/**
 * POST /api/test-date-maintenance (demande documentaire) lit les alertes non lues de chaque
 * destinataire pour éviter un doublon. Cette lecture est en meilleur effort : si elle lève,
 * les alertes sont créées et la réponse reste en 2xx.
 */

const ids = createIdBag();
const alertIds: number[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
let session: Awaited<ReturnType<typeof startContractActors<"admin">>>;

beforeAll(async () => {
  (global as any).broadcastUpdate = vi.fn();
  session = await startContractActors({ admin: "admin" } as const, ids.userIds);
}, 120000);

afterAll(async () => {
  vi.restoreAllMocks();
  (global as any).broadcastUpdate = previousBroadcast;
  if (alertIds.length > 0) await db.delete(alerts).where(inArray(alerts.id, alertIds));
  await cleanupCreated(ids);
  await session?.close();
});

describe("POST /api/test-date-maintenance : lecture des alertes non lues en échec", () => {
  it("reste en 200 et crée les alertes quand getUnreadAlertsByUserId lève", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const spy = vi.spyOn(storage, "getUnreadAlertsByUserId").mockRejectedValue(new Error("timeout exceeded when trying to connect"));

    const res = await session.call("POST", "/api/test-date-maintenance", {
      actor: "admin",
      body: { vehicleId: vehicle.id, alertType: "insurance" },
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();

    const created = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.link, `/vehicles/${vehicle.id}`), eq(alerts.title, "Demande renouvellement assurance")));
    alertIds.push(...created.map((a) => a.id));
    expect(res.status).toBe(200);
    expect(created.length).toBeGreaterThan(0);
  }, 60000);
  it("reste en 200 et notifie les rôles lisibles quand getUsersByRole lève pour un rôle", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const realGetUsersByRole = storage.getUsersByRole.bind(storage);
    const spy = vi.spyOn(storage, "getUsersByRole").mockImplementation(async (role: string) => {
      if (role === "workshop_manager") throw new Error("timeout exceeded when trying to connect");
      return realGetUsersByRole(role);
    });

    const res = await session.call("POST", "/api/test-date-maintenance", {
      actor: "admin",
      body: { vehicleId: vehicle.id, alertType: "insurance" },
    });
    expect(spy).toHaveBeenCalledWith("workshop_manager");
    spy.mockRestore();

    const created = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.link, `/vehicles/${vehicle.id}`), eq(alerts.title, "Demande renouvellement assurance")));
    alertIds.push(...created.map((a) => a.id));
    expect(res.status).toBe(200);
    // L'admin de la session est lisible : il reçoit la demande malgré l'échec de l'autre rôle.
    expect(created.map((a) => a.userId)).toContain(session.userIdOf("admin"));
  }, 60000);
});

