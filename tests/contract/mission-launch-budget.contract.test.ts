import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missionBudgets, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { apiErrorProblems } from "../support/api-error";
import { startContractSession } from "../support/contract-session";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Lancement d'une mission et budget de mission (L1g).
 *
 * Drapeau finance coupé : les trois contrôles budget de launch-readiness lisent l'ancien budget de la
 * fiche (`workflowData.budgetPlan`), quel que soit le budget de mission. Drapeau actif : ils lisent le
 * budget de mission, et seul un budget approuvé ou décaissé passe (carburant = montant carburant,
 * FDR = FDR, imprévus = frais annexes). Absent ou seulement demandé : refus qui dit quoi faire.
 * Le PUT de statut applique la même règle.
 */
type Actor = "logistics";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const missionIds: number[] = [];
const driverIds: number[] = [];
const ids = createIdBag();
const previousFlags = process.env.FEATURE_FLAGS;

const LEGACY = { fuelBudget: 111_000, roadExpensesBudget: 22_000, contingencyBudget: 3_000 };
const L1 = { fuelAmount: "50000.00", fdrAmount: "20000.00", extrasAmount: "5000.00" };
const BUDGET_KEYS = ["budget_fuel", "budget_road_expenses", "budget_contingency"] as const;
type BudgetState = "absent" | "requested" | "approved" | "disbursed";

async function missionWithBudget(state: BudgetState) {
  const [m] = await db
    .insert(missions)
    .values({
      orderNumber: uniqueTestToken("MLB"),
      pickupAddress: "A",
      deliveryAddress: "B",
      status: "assigned",
      workflowData: { budgetPlan: LEGACY },
    } as any)
    .returning();
  missionIds.push(m.id);
  if (state !== "absent") {
    await db.insert(missionBudgets).values({
      missionId: m.id,
      budgetDate: "2026-11-05",
      fuelLiters: "60.00",
      fuelUnitPrice: "833.33",
      ...L1,
      totalAmount: "75000.00",
      status: state,
    } as any);
  }
  return m.id;
}

async function budgetChecks(missionId: number) {
  const res = await session.call("GET", `/api/missions/${missionId}/launch-readiness`, { actor: "logistics" });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return BUDGET_KEYS.map((key) => res.body.checks.find((c: any) => c.key === key));
}

function withFlags(value: string) {
  beforeAll(() => {
    process.env.FEATURE_FLAGS = value;
  });
}

beforeAll(async () => {
  session = await startContractSession<Actor>({ logistics: "logistics" });
}, 60000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(missionBudgets).where(inArray(missionBudgets.missionId, missionIds));
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
});

describe("launch-readiness, drapeau finance coupé : l'ancien budget fait foi", { timeout: 60000 }, () => {
  withFlags("finance=off");
  for (const state of ["absent", "requested", "approved", "disbursed"] as const) {
    it(`budget de mission ${state} : contrôles sur l'ancien budget`, async () => {
      const [fuel, fdr, extras] = await budgetChecks(await missionWithBudget(state));
      expect([fuel.passed, fdr.passed, extras.passed]).toEqual([true, true, true]);
      expect([fuel.detail, fdr.detail, extras.detail]).toEqual(["111000 FCFA renseigné.", "22000 FCFA renseigné.", "3000 FCFA renseigné."]);
    });
  }
});

describe("launch-readiness, drapeau finance actif : le budget de mission fait foi", { timeout: 60000 }, () => {
  withFlags("finance=on");
  it("absent : refus qui dit de créer et faire approuver le budget, ancien budget ignoré", async () => {
    const checks = await budgetChecks(await missionWithBudget("absent"));
    for (const check of checks) {
      expect(check.passed, check.key).toBe(false);
      expect(check.blocking, check.key).toBe(true);
      expect(check.detail, check.key).toBe("Aucun budget de mission. Créer et faire approuver le budget dans l'onglet Budget.");
    }
  });

  it("demandé : refus en attente d'approbation", async () => {
    const checks = await budgetChecks(await missionWithBudget("requested"));
    for (const check of checks) {
      expect(check.passed, check.key).toBe(false);
      expect(check.detail, check.key).toBe("Budget de mission en attente d'approbation. Le faire approuver dans l'onglet Budget.");
    }
  });

  for (const state of ["approved", "disbursed"] as const) {
    it(`${state} : contrôles passés sur les montants du budget de mission (imprévus = frais annexes)`, async () => {
      const [fuel, fdr, extras] = await budgetChecks(await missionWithBudget(state));
      expect([fuel.passed, fdr.passed, extras.passed]).toEqual([true, true, true]);
      expect([fuel.detail, fdr.detail, extras.detail]).toEqual(["50000 FCFA renseigné.", "20000 FCFA renseigné.", "5000 FCFA renseigné."]);
    });
  }
});

describe("PUT /api/missions/:id/status vers in_progress, drapeau finance actif", { timeout: 60000 }, () => {
  withFlags("finance=on");
  async function assigned(state: BudgetState) {
    const missionId = await missionWithBudget(state);
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const [d] = await db
      .insert(drivers)
      .values({ firstName: "TEST", lastName: uniqueTestToken("drv"), employeeNumber: uniqueTestToken("emp"), isActive: true } as any)
      .returning();
    driverIds.push(d.id);
    await db.insert(assignments).values({ missionId, vehicleId: v.id, driverId: d.id, status: "accepted" } as any);
    return missionId;
  }
  const motifsOf = async (missionId: number) => {
    const res = await session.call("PUT", `/api/missions/${missionId}/status`, { actor: "logistics", body: { status: "in_progress" } });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(apiErrorProblems(res.status, res.body, 400)).toEqual([]);
    return res.body.motifs as string[];
  };

  it("sans budget de mission : un seul motif budget, qui dit quoi faire, malgré l'ancien budget", async () => {
    const motifs = await motifsOf(await assigned("absent"));
    const budget = motifs.filter((m) => /budget/i.test(m));
    expect(budget).toEqual(["Aucun budget de mission. Créer et faire approuver le budget dans l'onglet Budget."]);
  });

  it("budget demandé : motif d'approbation", async () => {
    const motifs = await motifsOf(await assigned("requested"));
    expect(motifs.filter((m) => /budget/i.test(m))).toEqual(["Budget de mission en attente d'approbation. Le faire approuver dans l'onglet Budget."]);
  });

  it("budget approuvé : aucun motif budget (les autres contrôles restent)", async () => {
    const res = await session.call("PUT", `/api/missions/${await assigned("approved")}/status`, { actor: "logistics", body: { status: "in_progress" } });
    const motifs: string[] = res.body?.motifs ?? [];
    expect(motifs.filter((m) => /budget/i.test(m)), JSON.stringify(res.body)).toEqual([]);
  });
});
