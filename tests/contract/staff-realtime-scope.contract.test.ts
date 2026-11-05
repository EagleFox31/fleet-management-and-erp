import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { inArray } from "drizzle-orm";
import { drivers, tires } from "../../shared/schema";
import { MISSION_EVENT_ROLES, STAFF_ROLES, SUPPLIER_READ_ROLES } from "../../shared/constants/roles";
import { getDefaultTireFormValues } from "../../shared/tire-form";
import { normalizeScope, resolveRecipients } from "../../server/lib/realtime-scope";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { uniqueTestToken } from "../support/ids";

/**
 * Portée des trames temps réel des fournisseurs, des pneus et des chauffeurs. Les trames sont
 * capturées à `broadcastUpdate` et leurs destinataires résolus par le résolveur réel
 * (`server/lib/realtime-scope.ts`, fermé par défaut).
 */
type Captured = { eventType: string; scope?: unknown };

const ACTORS = {
  admin: "admin",
  secretary: "secretary",
  warehouse: "warehouse",
  logistics: "logistics",
  workshop_manager: "workshop_manager",
  technician: "technician",
  management: "management",
  driver: "driver",
  other_driver: "driver",
  client: "client",
} as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const captured: Captured[] = [];
const tireIds: number[] = [];
const driverIds: number[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

const reaches = (scope: unknown, actor: Actor): boolean => {
  const userId = session.userIdOf(actor);
  const index = {
    byUser: new Map([[userId, new Set(["s"])]]),
    byRole: new Map([[ACTORS[actor], new Set(["s"])]]),
  };
  return resolveRecipients(normalizeScope(scope, null), index).size > 0;
};

const recipients = (eventType: string): Actor[] => {
  const frames = captured.filter((f) => f.eventType === eventType);
  expect(frames.length, `trame ${eventType} émise`).toBeGreaterThan(0);
  return (Object.keys(ACTORS) as Actor[]).filter((a) => frames.some((f) => reaches(f.scope, a)));
};

const actorsOfRoles = (roles: readonly string[]): Actor[] =>
  (Object.keys(ACTORS) as Actor[]).filter((a) => roles.includes(ACTORS[a]));

beforeAll(async () => {
  (global as any).broadcastUpdate = (eventType: string, data: any) => {
    captured.push({ eventType, scope: data?.scope });
  };
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (tireIds.length > 0) await db.delete(tires).where(inArray(tires.id, tireIds));
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("portée des trames fournisseurs, pneus, chauffeurs", { timeout: 120000 }, () => {
  it("fournisseur : rôles de lecture des fournisseurs seulement", async () => {
    const res = await session.call("POST", "/api/suppliers", {
      actor: "admin",
      body: { name: uniqueTestToken("rts-sup"), category: "Pièces", contactName: "Test", email: "rts@example.test", phone: "600000000" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    if (res.body?.id) ids.supplierIds.push(res.body.id);
    const got = recipients("supplier_created");
    expect(got.sort()).toEqual(actorsOfRoles(SUPPLIER_READ_ROLES).sort());
    expect(got).not.toContain("client");
    expect(got).not.toContain("driver");
  });

  it("pneu : personnel seulement, ni client", async () => {
    const res = await session.call("POST", "/api/tires", {
      actor: "warehouse",
      body: {
        ...getDefaultTireFormValues(),
        brand: "TEST",
        model: uniqueTestToken("rts-tire"),
        manufacturingWeek: "10",
        stockQuantity: 1,
        purchasePrice: 1000,
        supplier: "TEST",
        location: "TEST",
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    if (res.body?.id) tireIds.push(res.body.id);
    const tireEvents = captured.map((f) => f.eventType).filter((e) => e.startsWith("tire"));
    expect(tireEvents.length).toBeGreaterThan(0);
    for (const eventType of new Set(tireEvents)) {
      const got = recipients(eventType);
      expect(got).not.toContain("client");
      expect(got.sort()).toEqual(actorsOfRoles(STAFF_ROLES).sort());
    }
  });

  it("chauffeur : personnel hors chauffeur et chauffeur concerné seuls", async () => {
    const res = await session.call("POST", "/api/drivers", {
      actor: "admin",
      body: { firstName: "Test", lastName: uniqueTestToken("rts-drv"), userId: session.userIdOf("driver") },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const driverId = res.body.id as number;
    driverIds.push(driverId);

    captured.length = 0;
    const cpc = await session.call("POST", `/api/drivers/${driverId}/update-cpc`, {
      actor: "admin",
      body: { cpcDate: "2024-01-01" },
    });
    expect(cpc.status, JSON.stringify(cpc.body)).toBeLessThan(300);
    await new Promise((r) => setTimeout(r, 300));

    const got = recipients("driver_cpc_updated");
    expect(got).toContain("driver");
    expect(got).not.toContain("other_driver");
    expect(got).not.toContain("client");
    expect(got.filter((a) => a !== "driver").sort()).toEqual(actorsOfRoles(MISSION_EVENT_ROLES).sort());
  });
});
