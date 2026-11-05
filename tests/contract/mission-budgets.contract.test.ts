import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  dailyNeedResponseSchema,
  MISSION_BUDGETS_DAILY_NEED_PATH,
  MISSION_BUDGETS_PATH,
  missionBudgetApprovePath,
  missionBudgetDisbursePath,
  missionBudgetPath,
  missionBudgetSchema,
} from "../../shared/contracts/mission-budgets";
import { fuelPrices, missionBudgets, missions } from "../../shared/schema";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { TEST_PREFIX } from "../support/ids";

/** Niveau C, L1 : budget de mission (drapeau finance), rôles, calcul serveur, transitions, besoin du jour. */
// Suite en isolate: false : le drapeau est posé puis restauré, sans fuir vers les autres fichiers.
const previousFlags = process.env.FEATURE_FLAGS;

const ROLES = ["admin", "logistics", "management", "secretary", "technician", "client"] as const;
// Date propre au fichier : le besoin du jour ne somme que les budgets de ce test.
const DAY = "2031-03-17";
const PRICE = 911.5;

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
const userIds = new Map<string, number>();
const missionIds: number[] = [];
const events: { event: string; data: any }[] = [];

async function login(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  userIds.set(role, user.id);
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

async function newMission(): Promise<number> {
  const [m] = await db
    .insert(missions)
    .values({
      orderNumber: `${TEST_PREFIX}mb-${Date.now()}-${missionIds.length}`,
      pickupAddress: "Douala",
      deliveryAddress: "Yaoundé",
      createdBy: userIds.get("logistics")!,
    })
    .returning({ id: missions.id });
  missionIds.push(m.id);
  return m.id;
}

const body = (missionId: number, extra: Record<string, unknown> = {}) => ({
  missionId,
  budgetDate: DAY,
  fuelLiters: 200,
  fdrAmount: 40_000,
  extrasAmount: 5_000,
  ...extra,
});

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "finance=on";
  (global as any).broadcastUpdate = (event: string, data: unknown) => events.push({ event, data });
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of ROLES) await login(role);
  // Prix du jour propre au test, posé à la date du budget.
  await db
    .insert(fuelPrices)
    .values({ effectiveFrom: DAY, pricePerLiter: String(PRICE), createdBy: userIds.get("admin")! })
    .onConflictDoUpdate({ target: fuelPrices.effectiveFrom, set: { pricePerLiter: String(PRICE) } });
}, 180000);

afterAll(async () => {
  if (missionIds.length) {
    await db.delete(missionBudgets).where(inArray(missionBudgets.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  await db.delete(fuelPrices).where(inArray(fuelPrices.effectiveFrom, [DAY]));
  await cleanupCreated(ids);
  delete (global as any).broadcastUpdate;
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  await new Promise<void>((r) => server.close(() => r()));
});

describe("POST /api/mission-budgets", { timeout: 120000 }, () => {
  it("la logistique saisit : prix du jour figé, montants calculés par le serveur, statut demandé", async () => {
    const missionId = await newMission();
    const res = await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const b = missionBudgetSchema.parse(res.body);
    expect(b).toMatchObject({
      missionId,
      budgetDate: DAY,
      fuelLiters: 200,
      fuelUnitPrice: PRICE,
      fuelAmount: 182_300,
      fdrAmount: 40_000,
      extrasAmount: 5_000,
      totalAmount: 227_300,
      status: "requested",
      treasuryEntryId: null,
      createdBy: userIds.get("logistics"),
      updatedBy: userIds.get("logistics"),
    });
    expect(events.some((e) => e.event === "mission_budget_updated" && e.data?.id === b.id)).toBe(true);
  });

  it("l'administrateur saisit aussi ; direction, secrétariat, technicien et client : 403 ; anonyme : 401", async () => {
    const missionId = await newMission();
    for (const role of ["management", "secretary", "technician", "client"]) {
      expect((await call("POST", MISSION_BUDGETS_PATH, role, body(missionId))).status, role).toBe(403);
    }
    expect((await call("POST", MISSION_BUDGETS_PATH, undefined, body(missionId))).status).toBe(401);
    expect((await call("POST", MISSION_BUDGETS_PATH, "admin", body(missionId))).status).toBe(201);
  });

  it("un budget par mission : la seconde saisie répond 409 et n'écrit rien", async () => {
    const missionId = await newMission();
    expect((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId))).status).toBe(201);
    expect((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId, { fdrAmount: 1 }))).status).toBe(409);
    const rows = await db.select().from(missionBudgets).where(inArray(missionBudgets.missionId, [missionId]));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].fdrAmount)).toBe(40_000);
  });

  it("mission inconnue : 404 ; montants écrits par le client ou négatifs : 400", async () => {
    expect((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(2_000_000_000))).status).toBe(404);
    const missionId = await newMission();
    expect((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId, { totalAmount: 1 }))).status).toBe(400);
    expect((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId, { fuelUnitPrice: 1 }))).status).toBe(400);
    expect((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId, { fdrAmount: -5 }))).status).toBe(400);
  });
});

describe("Transitions requested -> approved -> disbursed", { timeout: 120000 }, () => {
  it("correction tant que demandé, approbation et décaissement par la direction, rejeu refusé en 409", async () => {
    const missionId = await newMission();
    const created = missionBudgetSchema.parse((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId))).body);

    const patched = await call("PATCH", missionBudgetPath(created.id), "logistics", { fuelLiters: 100 });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ fuelAmount: 91_150, totalAmount: 136_150, status: "requested" });

    // La logistique n'approuve pas, la direction ne décaisse pas avant approbation.
    expect((await call("POST", missionBudgetApprovePath(created.id), "logistics")).status).toBe(403);
    expect((await call("POST", missionBudgetApprovePath(created.id), "secretary")).status).toBe(403);
    expect((await call("POST", missionBudgetDisbursePath(created.id), "management")).status).toBe(409);

    const approved = await call("POST", missionBudgetApprovePath(created.id), "management");
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: "approved", approvedBy: userIds.get("management") });
    expect((await call("POST", missionBudgetApprovePath(created.id), "management")).status).toBe(409);
    // Approuvé : plus de correction.
    expect((await call("PATCH", missionBudgetPath(created.id), "logistics", { fdrAmount: 1 })).status).toBe(409);

    const disbursed = await call("POST", missionBudgetDisbursePath(created.id), "admin");
    expect(disbursed.status).toBe(200);
    expect(disbursed.body).toMatchObject({
      status: "disbursed",
      disbursedBy: userIds.get("admin"),
      updatedBy: userIds.get("admin"),
      treasuryEntryId: null,
    });
    expect((await call("POST", missionBudgetDisbursePath(created.id), "admin")).status).toBe(409);
  });

  it("budget inconnu : 404 ; id hors plage : 400", async () => {
    expect((await call("POST", missionBudgetApprovePath(2_000_000_000), "management")).status).toBe(404);
    expect((await call("POST", missionBudgetApprovePath(2_147_483_648), "management")).status).toBe(400);
  });
});

describe("Lecture et besoin du jour", { timeout: 120000 }, () => {
  it("lecture : logistique, direction, administrateur ; 403 pour secrétariat, technicien, client", async () => {
    for (const role of ["logistics", "management", "admin"]) {
      expect((await call("GET", `${MISSION_BUDGETS_PATH}?date=${DAY}`, role)).status, role).toBe(200);
    }
    for (const role of ["secretary", "technician", "client"]) {
      expect((await call("GET", `${MISSION_BUDGETS_PATH}?date=${DAY}`, role)).status, role).toBe(403);
      expect((await call("GET", `${MISSION_BUDGETS_DAILY_NEED_PATH}?date=${DAY}`, role)).status, role).toBe(403);
    }
  });

  it("le besoin du jour somme les budgets de la date, au total et par statut", async () => {
    const list = await call("GET", `${MISSION_BUDGETS_PATH}?date=${DAY}`, "management");
    const rows = (list.body as any[]).map((r) => missionBudgetSchema.parse(r));
    expect(rows.length).toBeGreaterThan(0);
    const res = await call("GET", `${MISSION_BUDGETS_DAILY_NEED_PATH}?date=${DAY}`, "management");
    expect(res.status).toBe(200);
    const need = dailyNeedResponseSchema.parse(res.body);
    const sum = (k: "totalAmount" | "fuelAmount") => Math.round(rows.reduce((s, r) => s + r[k] * 100, 0)) / 100;
    expect(need).toMatchObject({ date: DAY, count: rows.length, totalAmount: sum("totalAmount"), fuelAmount: sum("fuelAmount") });
    const byStatusCount = Object.values(need.byStatus).reduce((s, t) => s + (t?.count ?? 0), 0);
    expect(byStatusCount).toBe(rows.length);
    expect(need.byStatus.disbursed?.count).toBeGreaterThan(0);
  });

  it("date absente ou illisible : 400", async () => {
    expect((await call("GET", MISSION_BUDGETS_DAILY_NEED_PATH, "management")).status).toBe(400);
    expect((await call("GET", `${MISSION_BUDGETS_DAILY_NEED_PATH}?date=demain`, "management")).status).toBe(400);
  });
});

describe("Drapeau finance coupé", { timeout: 120000 }, () => {
  it("toutes les routes répondent 404", async () => {
    const saved = process.env.FEATURE_FLAGS;
    process.env.FEATURE_FLAGS = "";
    try {
      expect((await call("GET", MISSION_BUDGETS_PATH, "admin")).status).toBe(404);
      expect((await call("GET", `${MISSION_BUDGETS_DAILY_NEED_PATH}?date=${DAY}`, "admin")).status).toBe(404);
      expect((await call("POST", MISSION_BUDGETS_PATH, "admin", body(1))).status).toBe(404);
      expect((await call("POST", missionBudgetApprovePath(1), "admin")).status).toBe(404);
    } finally {
      process.env.FEATURE_FLAGS = saved;
    }
  });
});
