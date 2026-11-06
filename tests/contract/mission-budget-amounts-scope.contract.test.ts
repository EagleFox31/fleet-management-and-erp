import { inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { FuelCardService } from "../../server/services/fuel-card-service";
import { FUEL_BALANCE_OK_DETAIL, FUEL_SHORTFALL_DETAIL, LEGACY_FUEL_SHORTFALL_DETAIL } from "../../server/services/mission-launch-budget";
import { assignments, drivers, missionBudgets, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Montants du budget d'une mission (Q19) : ancien budget de la fiche (`workflowData.budgetPlan`),
 * `estimatedFuelCost`, budget de mission et solde de la carte carburant. Technicien et chauffeur n'en reçoivent
 * aucun, drapeau `finance` actif comme coupé : chaque montant est une sentinelle cherchée dans
 * `JSON.stringify(body)` entier. La logistique, lectrice, les voit.
 */
const ACTORS = { logistics: "logistics", technician: "technician", driver: "driver" } as const;
type Actor = keyof typeof ACTORS;

const ESTIMATED_FUEL_COST = 7319531;
const LEGACY = { fuelBudget: 6428713, roadExpensesBudget: 5382197, contingencyBudget: 4271639 };
const L1 = { fuelAmount: 8132977, fdrAmount: 2914863, extrasAmount: 1592647 };
const BALANCE = 46813579;
const SENTINELS = [ESTIMATED_FUEL_COST, ...Object.values(LEGACY), ...Object.values(L1), BALANCE].map(String);
/** Budget carburant qu'aucun solde ne couvre : déclenche le motif « solde insuffisant ». */
const HUGE_FUEL = 9876543210;

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);
let driverRowId = 0;
let vehicleRowId = 0;
const previousFlags = process.env.FEATURE_FLAGS;

function leaked(body: unknown, extra: string[] = []): string[] {
  const sent = JSON.stringify(body);
  return [...SENTINELS, ...extra].filter((s) => sent.includes(s));
}

async function missionWith(status: string, opts: { fuelBudget?: number; l1Fuel?: number } = {}) {
  const [m] = await db
    .insert(missions)
    .values({
      orderNumber: uniqueTestToken("MBS"),
      pickupAddress: "TEST A",
      deliveryAddress: "TEST B",
      status,
      estimatedFuelCost: String(ESTIMATED_FUEL_COST),
      workflowData: { budgetPlan: { ...LEGACY, fuelBudget: opts.fuelBudget ?? LEGACY.fuelBudget } },
    } as any)
    .returning();
  missionIds.push(m.id);
  const fuelAmount = opts.l1Fuel ?? L1.fuelAmount;
  await db.insert(missionBudgets).values({
    missionId: m.id,
    budgetDate: "2026-11-05",
    fuelLiters: "60.00",
    fuelUnitPrice: "833.33",
    fuelAmount: `${fuelAmount}.00`,
    fdrAmount: `${L1.fdrAmount}.00`,
    extrasAmount: `${L1.extrasAmount}.00`,
    totalAmount: `${fuelAmount + L1.fdrAmount + L1.extrasAmount}.00`,
    status: "approved",
  } as any);
  await db
    .insert(assignments)
    .values({ missionId: m.id, vehicleId: vehicleRowId, driverId: driverRowId, status: status === "in_progress" ? "in_progress" : "accepted" } as any);
  return m.id;
}

const rowOf = (body: unknown, id: number) => (body as any[]).map((m) => m.mission ?? m).find((m) => m.id === id);

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const [d] = await db
    .insert(drivers)
    .values({ userId: session.userIdOf("driver"), firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME" } as any)
    .returning();
  driverIds.push(d.id);
  driverRowId = d.id;
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  vehicleRowId = v.id;
  vi.spyOn(FuelCardService.prototype, "getCurrentBalance").mockResolvedValue({ balance: BALANCE } as any);
}, 120000);

afterEach(() => {
  delete (global as any).broadcastUpdate;
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (missionIds.length > 0) {
    await db.delete(missionBudgets).where(inArray(missionBudgets.missionId, missionIds));
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
}, 120000);

for (const flag of ["on", "off"] as const) {
  describe(`lectures, drapeau finance ${flag}`, { timeout: 180000 }, () => {
    let missionId = 0;
    beforeAll(async () => {
      process.env.FEATURE_FLAGS = `finance=${flag}`;
      missionId = await missionWith("assigned");
    });

    it("GET /api/missions et /:id : technicien et chauffeur ne reçoivent aucun montant", async () => {
      for (const actor of ["technician", "driver"] as const) {
        const list = await call("GET", "/api/missions", { actor });
        expect(list.status, actor).toBe(200);
        expect(rowOf(list.body, missionId), `${actor} voit la mission`).toBeDefined();
        expect(leaked(list.body), `${actor} liste`).toEqual([]);
        const detail = await call("GET", `/api/missions/${missionId}`, { actor });
        expect(detail.status, actor).toBe(200);
        expect(detail.body.estimatedFuelCost, actor).toBeNull();
        expect(leaked(detail.body), `${actor} détail`).toEqual([]);
      }
    });

    it("GET /:id/fuel-records et /:id/launch-readiness : technicien sans montant ni solde, verdicts conservés", async () => {
      const fuel = await call("GET", `/api/missions/${missionId}/fuel-records`, { actor: "technician" });
      expect(fuel.status).toBe(200);
      expect(leaked(fuel.body), "fuel-records").toEqual([]);
      const ready = await call("GET", `/api/missions/${missionId}/launch-readiness`, { actor: "technician" });
      expect(ready.status, JSON.stringify(ready.body)).toBe(200);
      expect(leaked(ready.body), "launch-readiness").toEqual([]);
      expect(ready.body.fuel.balance).toBeNull();
      expect(ready.body.fuel.requiredBudget).toBeNull();
      const balanceCheck = ready.body.checks.find((c: any) => c.key === "fuel_balance");
      expect([balanceCheck.passed, balanceCheck.detail]).toEqual([true, FUEL_BALANCE_OK_DETAIL]);
    });

    it("logistique (lectrice) : montants et solde visibles", async () => {
      const detail = await call("GET", `/api/missions/${missionId}`, { actor: "logistics" });
      expect(Number(detail.body.estimatedFuelCost)).toBe(ESTIMATED_FUEL_COST);
      expect(detail.body.workflowData.budgetPlan.fuelBudget).toBe(LEGACY.fuelBudget);
      const ready = await call("GET", `/api/missions/${missionId}/launch-readiness`, { actor: "logistics" });
      expect(ready.body.fuel.balance).toBe(BALANCE);
      expect(ready.body.fuel.requiredBudget).toBe(flag === "on" ? L1.fuelAmount : LEGACY.fuelBudget);
    });
  });
}

describe("PUT /api/missions/:id/status par le chauffeur", { timeout: 180000 }, () => {
  for (const [flag, motif] of [["off", LEGACY_FUEL_SHORTFALL_DETAIL], ["on", FUEL_SHORTFALL_DETAIL]] as const) {
    it(`drapeau ${flag}, budget carburant ${HUGE_FUEL} : motif « solde insuffisant » sans montant`, async () => {
      process.env.FEATURE_FLAGS = `finance=${flag}`;
      const missionId = await missionWith("assigned", { fuelBudget: HUGE_FUEL, l1Fuel: HUGE_FUEL });
      const res = await call("PUT", `/api/missions/${missionId}/status`, { actor: "driver", body: { status: "in_progress" } });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.motifs).toContain(motif);
      expect(leaked(res.body, [String(HUGE_FUEL)])).toEqual([]);
    });
  }

  it("réponse 200 et trame temps réel : aucun montant", async () => {
    process.env.FEATURE_FLAGS = "finance=on";
    const missionId = await missionWith("in_progress");
    const spy = vi.fn();
    (global as any).broadcastUpdate = spy;
    const res = await call("PUT", `/api/missions/${missionId}/status`, { actor: "driver", body: { status: "delivered" } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.id).toBe(missionId);
    expect(leaked(res.body), "réponse").toEqual([]);
    expect(spy).toHaveBeenCalled();
    expect(leaked(spy.mock.calls), "trame").toEqual([]);
  });
});
