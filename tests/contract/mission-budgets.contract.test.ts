import { createServer, type Server } from "http";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  dailyNeedResponseSchema,
  MISSION_BUDGETS_DAILY_NEED_PATH,
  MISSION_BUDGETS_PATH,
  missionBudgetApprovePath,
  missionBudgetDisbursePath,
  missionBudgetPath,
  missionBudgetSchema,
  MISSION_DESTINATIONS_PATH,
  missionDestinationsResponseSchema,
} from "../../shared/contracts/mission-budgets";
import { addDaysToIsoDate } from "../../shared/constants/document-renewal-statuses";
import { fuelPrices, missionBudgets, missionDestinations, missions, treasuryAccounts, treasuryEntries } from "../../shared/schema";
import { db } from "../../server/db";
import { onMissionStatusChange, resolveBudgetFuelPrice } from "../../server/services/mission-budgets-service";
import { linkMissionBudgetDisbursement } from "../../server/services/treasury-links";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { TEST_PREFIX } from "../support/ids";

/** Niveau C, L1 : budget de mission (drapeau finance), rôles, calcul serveur, transitions, besoin du jour. */
// Suite en isolate: false : le drapeau est posé puis restauré, sans fuir vers les autres fichiers.
const previousFlags = process.env.FEATURE_FLAGS;
/** Comptes de trésorerie créés par ce fichier (L1c). */
const treasuryAccountIds: number[] = [];

const ROLES = ["admin", "logistics", "management", "secretary", "technician", "driver", "client"] as const;
// Date du fichier, dans la fenêtre de saisie (± 60 j) : le besoin du jour ne somme que les budgets de ce test.
const TODAY = new Date().toISOString().slice(0, 10);
const DAY = addDaysToIsoDate(TODAY, 37);
const PRICE = 911.5;

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
const userIds = new Map<string, number>();
const missionIds: number[] = [];
const events: { event: string; data: any }[] = [];
// Prix déjà posé à DAY par un autre fichier : restauré en fin de test, jamais supprimé.
let previousPrice: string | null = null;
/** [active, retirée] */
const destinationIds: number[] = [];

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

/** Version lue, portée par l'approbation et le décaissement. */
const seen = (b: { updatedAt: string }) => ({ expectedUpdatedAt: b.updatedAt });

const body = (missionId: number, extra: Record<string, unknown> = {}) => ({
  missionId,
  budgetDate: DAY,
  fuelLiters: 200,
  fdrAmount: 40_000,
  extrasAmount: 5_000,
  ...extra,
});

/** Compte de trésorerie de test (L1c), supprimé en fin de fichier. */
async function newTreasuryAccount(kind: "bank" | "cash" | "fuel_card", isActive = true): Promise<number> {
  const [row] = await db
    .insert(treasuryAccounts)
    .values({
      code: `${TEST_PREFIX}mb-${kind}-${isActive}-${Date.now()}-${treasuryAccountIds.length}`,
      label: `${TEST_PREFIX} ${kind}`,
      kind,
      isActive,
      createdBy: userIds.get("admin")!,
    })
    .returning({ id: treasuryAccounts.id });
  treasuryAccountIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "finance=on";
  (global as any).broadcastUpdate = (event: string, data: unknown) => events.push({ event, data });
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of ROLES) await login(role);
  // Prix du jour propre au test, posé à la date du budget.
  const [existing] = await db.select().from(fuelPrices).where(eq(fuelPrices.effectiveFrom, DAY));
  previousPrice = existing ? existing.pricePerLiter : null;
  await db
    .insert(fuelPrices)
    .values({ effectiveFrom: DAY, pricePerLiter: String(PRICE), createdBy: userIds.get("admin")! })
    .onConflictDoUpdate({ target: fuelPrices.effectiveFrom, set: { pricePerLiter: String(PRICE) } });
  // Destinations propres au test : le barème semé par la migration n'est ni lu ni modifié.
  const rows = await db
    .insert(missionDestinations)
    .values([
      // createdBy de test : un run interrompu avant afterAll est rattrapé par le ménage des comptes de test.
      { code: `${TEST_PREFIX}mb-dest-${Date.now()}`, label: `${TEST_PREFIX} Destination`, fuelLiters: "450", fdrAmount: "100000", createdBy: userIds.get("admin")! },
      { code: `${TEST_PREFIX}mb-retired-${Date.now()}`, label: `${TEST_PREFIX} Retirée`, fuelLiters: "1", fdrAmount: "1", active: false, createdBy: userIds.get("admin")! },
    ])
    .returning({ id: missionDestinations.id });
  destinationIds.push(...rows.map((r) => r.id));
}, 180000);

afterAll(async () => {
  if (missionIds.length) {
    await db.delete(missionBudgets).where(inArray(missionBudgets.missionId, missionIds));
    await db.delete(treasuryEntries).where(inArray(treasuryEntries.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (treasuryAccountIds.length) await db.delete(treasuryAccounts).where(inArray(treasuryAccounts.id, treasuryAccountIds));
  if (destinationIds.length) await db.delete(missionDestinations).where(inArray(missionDestinations.id, destinationIds));
  if (previousPrice === null) await db.delete(fuelPrices).where(eq(fuelPrices.effectiveFrom, DAY));
  else await db.update(fuelPrices).set({ pricePerLiter: previousPrice }).where(eq(fuelPrices.effectiveFrom, DAY));
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
    for (const role of ["management", "secretary", "technician", "driver", "client"]) {
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

  it("date hors fenêtre de ± 60 jours : 400 ; aucun prix carburant à la date : 409, sans prix par défaut", async () => {
    const missionId = await newMission();
    for (const budgetDate of [addDaysToIsoDate(TODAY, 61), addDaysToIsoDate(TODAY, -61)]) {
      expect((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId, { budgetDate }))).status, budgetDate).toBe(400);
    }
    await expect(resolveBudgetFuelPrice("1900-01-01")).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(missionBudgets).where(eq(missionBudgets.missionId, missionId))).toHaveLength(0);
  });

  it("mission inconnue : 404 ; montants écrits par le client ou négatifs : 400", async () => {
    expect((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(2_000_000_000))).status).toBe(404);
    const missionId = await newMission();
    expect((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId, { totalAmount: 1 }))).status).toBe(400);
    expect((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId, { fuelUnitPrice: 1 }))).status).toBe(400);
    expect((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId, { fdrAmount: -5 }))).status).toBe(400);
  });

  it("mission terminée ou annulée : 409, aucun budget écrit", async () => {
    for (const status of ["completed", "cancelled"] as const) {
      const missionId = await newMission();
      await db.update(missions).set({ status }).where(eq(missions.id, missionId));
      expect((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId))).status, status).toBe(409);
      expect(await db.select().from(missionBudgets).where(eq(missionBudgets.missionId, missionId))).toHaveLength(0);
    }
  });

  it("mission close après la saisie : correction, approbation et décaissement refusés (409), budget intact", async () => {
    for (const status of ["cancelled", "completed"] as const) {
      // Demandé : correction et approbation refusées.
      const requested = missionBudgetSchema.parse((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(await newMission()))).body);
      await db.update(missions).set({ status }).where(eq(missions.id, requested.missionId));
      expect((await call("PATCH", missionBudgetPath(requested.id), "logistics", { fdrAmount: 1 })).status, status).toBe(409);
      expect((await call("POST", missionBudgetApprovePath(requested.id), "management", seen(requested))).status, status).toBe(409);

      // Approuvé puis mission close : décaissement refusé.
      const created = missionBudgetSchema.parse((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(await newMission()))).body);
      const approved = missionBudgetSchema.parse(
        (await call("POST", missionBudgetApprovePath(created.id), "management", seen(created))).body,
      );
      await db.update(missions).set({ status }).where(eq(missions.id, created.missionId));
      expect((await call("POST", missionBudgetDisbursePath(created.id), "admin", seen(approved))).status, status).toBe(409);

      const rows = await db.select().from(missionBudgets).where(inArray(missionBudgets.id, [requested.id, created.id]));
      expect(rows.find((r) => r.id === requested.id)).toMatchObject({ status: "requested", fdrAmount: "40000.00", approvedBy: null });
      expect(rows.find((r) => r.id === created.id)).toMatchObject({ status: "approved", disbursedBy: null });
    }
  });

  it("correction : notes seules sans re-figer le prix ; corps identique sans écriture", async () => {
    const missionId = await newMission();
    const created = missionBudgetSchema.parse((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId))).body);
    // Le prix du jour change après la saisie : seule une correction de montant ou de date le reprend.
    await db.update(fuelPrices).set({ pricePerLiter: String(PRICE + 100) }).where(eq(fuelPrices.effectiveFrom, DAY));
    try {
      const noted = await call("PATCH", missionBudgetPath(created.id), "logistics", { notes: "Convoi de nuit" });
      expect(noted.status).toBe(200);
      expect(noted.body).toMatchObject({ notes: "Convoi de nuit", fuelUnitPrice: created.fuelUnitPrice, totalAmount: created.totalAmount });
      expect(noted.body.updatedAt).not.toBe(created.updatedAt);

      const before = events.length;
      for (const same of [{ notes: "Convoi de nuit" }, { fuelLiters: created.fuelLiters, budgetDate: created.budgetDate }]) {
        const res = await call("PATCH", missionBudgetPath(created.id), "logistics", same);
        expect(res.status).toBe(200);
        expect(res.body.updatedAt, JSON.stringify(same)).toBe(noted.body.updatedAt);
      }
      expect(events.length).toBe(before);

      const repriced = await call("PATCH", missionBudgetPath(created.id), "logistics", { fuelLiters: created.fuelLiters + 1 });
      expect(repriced.status).toBe(200);
      expect(repriced.body.fuelUnitPrice).toBe(PRICE + 100);
    } finally {
      await db.update(fuelPrices).set({ pricePerLiter: String(PRICE) }).where(eq(fuelPrices.effectiveFrom, DAY));
    }
  });
});

describe("Transitions requested -> approved -> disbursed", { timeout: 120000 }, () => {
  it("correction tant que demandé, approbation et décaissement par la direction, rejeu refusé en 409", async () => {
    const missionId = await newMission();
    const created = missionBudgetSchema.parse((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId))).body);

    const patched = await call("PATCH", missionBudgetPath(created.id), "logistics", { fuelLiters: 100 });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ fuelAmount: 91_150, totalAmount: 136_150, status: "requested" });

    // La logistique n'approuve pas et ne décaisse pas avant approbation.
    const v1 = seen(patched.body);
    for (const role of ["logistics", "secretary", "driver"]) {
      expect((await call("POST", missionBudgetApprovePath(created.id), role, v1)).status, role).toBe(403);
    }
    expect((await call("POST", missionBudgetDisbursePath(created.id), "logistics", v1)).status).toBe(409);
    // Sans version lue : 400.
    expect((await call("POST", missionBudgetApprovePath(created.id), "management", {})).status).toBe(400);

    const approved = await call("POST", missionBudgetApprovePath(created.id), "management", v1);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: "approved", approvedBy: userIds.get("management") });
    expect((await call("POST", missionBudgetApprovePath(created.id), "management", seen(approved.body))).status).toBe(409);
    // Approuvé : plus de correction.
    expect((await call("PATCH", missionBudgetPath(created.id), "logistics", { fdrAmount: 1 })).status).toBe(409);
    // Qui approuve ne décaisse pas ; chauffeur, technicien et client non plus.
    const bank = await newTreasuryAccount("bank");
    for (const role of ["management", "technician", "driver", "client"]) {
      expect((await call("POST", missionBudgetDisbursePath(created.id), role, { ...seen(approved.body), treasuryAccountId: bank })).status, role).toBe(403);
    }
    // Finance active : le compte source est obligatoire.
    expect((await call("POST", missionBudgetDisbursePath(created.id), "admin", seen(approved.body))).status).toBe(400);

    const disbursed = await call("POST", missionBudgetDisbursePath(created.id), "admin", { ...seen(approved.body), treasuryAccountId: bank });
    expect(disbursed.status).toBe(200);
    expect(disbursed.body).toMatchObject({ status: "disbursed", disbursedBy: userIds.get("admin"), updatedBy: userIds.get("admin") });
    expect(disbursed.body.treasuryEntryId).toEqual(expect.any(Number));
    expect((await call("POST", missionBudgetDisbursePath(created.id), "admin", { ...seen(disbursed.body), treasuryAccountId: bank })).status).toBe(409);
  });

  it("approbation liée à la version lue : un budget corrigé depuis répond 409 et reste demandé", async () => {
    const missionId = await newMission();
    const created = missionBudgetSchema.parse((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId))).body);
    expect((await call("PATCH", missionBudgetPath(created.id), "logistics", { fdrAmount: 90_000 })).status).toBe(200);
    const stale = await call("POST", missionBudgetApprovePath(created.id), "management", seen(created));
    expect(stale.status).toBe(409);
    const [row] = await db.select().from(missionBudgets).where(eq(missionBudgets.id, created.id));
    expect(row.status).toBe("requested");
    expect(row.approvedBy).toBeNull();
  });

  it("deux décaissements simultanés : un seul 200, l'autre 409", async () => {
    const missionId = await newMission();
    const created = missionBudgetSchema.parse((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId))).body);
    const approved = missionBudgetSchema.parse(
      (await call("POST", missionBudgetApprovePath(created.id), "management", seen(created))).body,
    );
    const bank = await newTreasuryAccount("bank");
    const results = await Promise.all([
      call("POST", missionBudgetDisbursePath(created.id), "logistics", { ...seen(approved), treasuryAccountId: bank }),
      call("POST", missionBudgetDisbursePath(created.id), "admin", { ...seen(approved), treasuryAccountId: bank }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("budget inconnu : 404 ; id hors plage : 400", async () => {
    const v = { expectedUpdatedAt: new Date().toISOString() };
    expect((await call("POST", missionBudgetApprovePath(2_000_000_000), "management", v)).status).toBe(404);
    expect((await call("POST", missionBudgetApprovePath(2_147_483_648), "management", v)).status).toBe(400);
  });
});

describe("Lecture et besoin du jour", { timeout: 120000 }, () => {
  it("détail GET /:id : rôles de lecture (dont secrétariat, qui décaisse) 200, égal à la saisie ; autres 403 ; anonyme 401 ; inconnu 404 ; id non strict 400", async () => {
    const created = await call("POST", MISSION_BUDGETS_PATH, "logistics", body(await newMission()));
    expect(created.status).toBe(201);
    const path = missionBudgetPath(created.body.id);
    for (const role of ["logistics", "management", "secretary", "admin"]) {
      const res = await call("GET", path, role);
      expect(res.status, role).toBe(200);
      expect(missionBudgetSchema.parse(res.body), role).toEqual(missionBudgetSchema.parse(created.body));
    }
    for (const role of ["technician", "driver", "client"]) {
      expect((await call("GET", path, role)).status, role).toBe(403);
    }
    expect((await call("GET", path)).status).toBe(401);
    expect((await call("GET", missionBudgetPath(2_000_000_000), "admin")).status).toBe(404);
    for (const raw of [`${created.body.id}abc`, "0", "2147483648"]) {
      expect((await call("GET", `${MISSION_BUDGETS_PATH}/${raw}`, "admin")).status, raw).toBe(400);
    }
  });

  it("lecture : logistique, direction, secrétariat (qui décaisse), administrateur ; 403 pour technicien, chauffeur, client", async () => {
    for (const role of ["logistics", "management", "secretary", "admin"]) {
      expect((await call("GET", `${MISSION_BUDGETS_PATH}?date=${DAY}`, role)).status, role).toBe(200);
      expect((await call("GET", `${MISSION_BUDGETS_DAILY_NEED_PATH}?date=${DAY}`, role)).status, role).toBe(200);
    }
    for (const role of ["technician", "driver", "client"]) {
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

describe("Barème par destination (L1b)", { timeout: 120000 }, () => {
  it("liste des destinations actives : lecture logistique, direction, administrateur ; retirée absente", async () => {
    for (const role of ["logistics", "management", "admin"]) {
      const res = await call("GET", MISSION_DESTINATIONS_PATH, role);
      expect(res.status, role).toBe(200);
      const list = missionDestinationsResponseSchema.parse(res.body);
      expect(list.map((d) => d.id)).toContain(destinationIds[0]);
      expect(list.map((d) => d.id)).not.toContain(destinationIds[1]);
    }
    for (const role of ["technician", "driver", "client"]) {
      expect((await call("GET", MISSION_DESTINATIONS_PATH, role)).status, role).toBe(403);
    }
  });

  it("une destination pré-remplit litres et FDR absents ; une valeur fournie l'emporte", async () => {
    const prefilled = await call("POST", MISSION_BUDGETS_PATH, "logistics", {
      missionId: await newMission(), budgetDate: DAY, destinationId: destinationIds[0],
    });
    expect(prefilled.status, JSON.stringify(prefilled.body)).toBe(201);
    expect(prefilled.body).toMatchObject({ destinationId: destinationIds[0], fuelLiters: 450, fdrAmount: 100_000, fuelUnitPrice: PRICE });

    const overridden = await call("POST", MISSION_BUDGETS_PATH, "logistics", {
      missionId: await newMission(), budgetDate: DAY, destinationId: destinationIds[0], fdrAmount: 80_000,
    });
    expect(overridden.status).toBe(201);
    expect(overridden.body).toMatchObject({ fuelLiters: 450, fdrAmount: 80_000 });
  });

  it("destination retirée ou inconnue : 400 ; sans destination, litres et FDR requis : 400", async () => {
    const missionId = await newMission();
    for (const destinationId of [destinationIds[1], 2_000_000_000]) {
      const res = await call("POST", MISSION_BUDGETS_PATH, "logistics", { missionId, budgetDate: DAY, destinationId });
      expect(res.status, String(destinationId)).toBe(400);
    }
    expect((await call("POST", MISSION_BUDGETS_PATH, "logistics", { missionId, budgetDate: DAY, fdrAmount: 1 })).status).toBe(400);
    expect(await db.select().from(missionBudgets).where(eq(missionBudgets.missionId, missionId))).toHaveLength(0);
  });

  it("correction : changer de destination n'écrase pas les montants ; la retirer remet la saisie libre", async () => {
    const created = missionBudgetSchema.parse((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(await newMission()))).body);
    const linked = await call("PATCH", missionBudgetPath(created.id), "logistics", { destinationId: destinationIds[0] });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ destinationId: destinationIds[0], fuelLiters: created.fuelLiters, fdrAmount: created.fdrAmount });
    expect((await call("PATCH", missionBudgetPath(created.id), "logistics", { destinationId: destinationIds[1] })).status).toBe(400);
    const unlinked = await call("PATCH", missionBudgetPath(created.id), "logistics", { destinationId: null });
    expect(unlinked.status).toBe(200);
    expect(unlinked.body.destinationId).toBeNull();
  });
});

describe("Décaissement au journal de trésorerie (L1c)", { timeout: 120000 }, () => {
  const accounts = { bank: 0, cash: 0, inactive: 0, card: 0 };

  const account = newTreasuryAccount;

  beforeAll(async () => {
    accounts.bank = await account("bank");
    accounts.cash = await account("cash");
    accounts.inactive = await account("bank", false);
    // Une seule carte active en base (index unique partiel) : une carte existante sert telle quelle.
    const [card] = await db
      .select({ id: treasuryAccounts.id })
      .from(treasuryAccounts)
      .where(and(eq(treasuryAccounts.kind, "fuel_card"), eq(treasuryAccounts.isActive, true)));
    accounts.card = card ? card.id : await account("fuel_card");
  });

  async function approvedBudget(extra: Record<string, unknown> = {}) {
    const missionId = await newMission();
    const created = missionBudgetSchema.parse((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId, extra))).body);
    const approved = missionBudgetSchema.parse((await call("POST", missionBudgetApprovePath(created.id), "management", seen(created))).body);
    return { missionId, approved };
  }

  const entriesOf = (budgetId: number) =>
    db.select().from(treasuryEntries).where(like(treasuryEntries.requestKey, `mission-budget:${budgetId}:%`));

  it("avec un compte : deux sorties liées à la mission ; le budget retient la ligne FDR ; rejeu sans doublon", async () => {
    const { missionId, approved } = await approvedBudget();
    const res = await call("POST", missionBudgetDisbursePath(approved.id), "logistics", { ...seen(approved), treasuryAccountId: accounts.bank });
    expect(res.status).toBe(200);
    const entries = await entriesOf(approved.id);
    expect(entries).toHaveLength(2);
    const byKey = new Map(entries.map((e) => [e.requestKey, e]));
    const fdr = byKey.get(`mission-budget:${approved.id}:fdr`)!;
    const fuel = byKey.get(`mission-budget:${approved.id}:carburant`)!;
    // body() : FDR 40 000 + frais annexes 5 000 ; carburant = fuelAmount calculé par le service.
    expect(fdr).toMatchObject({ accountId: accounts.bank, direction: "out", amount: "45000.00", category: "fdr", missionId, createdBy: userIds.get("logistics") });
    expect(fuel).toMatchObject({ accountId: accounts.bank, direction: "out", category: "carburant", missionId });
    expect(Number(fuel.amount)).toBe(Number(approved.fuelAmount));
    expect(res.body).toMatchObject({ status: "disbursed", treasuryEntryId: fdr.id });

    // Rejeu HTTP : 409, rien de plus au journal.
    expect((await call("POST", missionBudgetDisbursePath(approved.id), "logistics", { ...seen(res.body), treasuryAccountId: accounts.bank })).status).toBe(409);
    // Rejeu du lien seul : clés déjà prises, aucune seconde ligne, même écriture retenue.
    const [row] = await db.select().from(missionBudgets).where(eq(missionBudgets.id, approved.id));
    const again = await db.transaction((tx) => linkMissionBudgetDisbursement(tx as never, row, accounts.bank, userIds.get("admin")!));
    expect(again).toBe(fdr.id);
    expect(await entriesOf(approved.id)).toHaveLength(2);
  });

  it("caisse acceptée ; sans FDR ni frais annexes, seule la ligne carburant est écrite et retenue", async () => {
    const { approved } = await approvedBudget({ fdrAmount: 0, extrasAmount: 0 });
    const res = await call("POST", missionBudgetDisbursePath(approved.id), "admin", { ...seen(approved), treasuryAccountId: accounts.cash });
    expect(res.status).toBe(200);
    const entries = await entriesOf(approved.id);
    expect(entries.map((e) => e.requestKey)).toEqual([`mission-budget:${approved.id}:carburant`]);
    expect(res.body.treasuryEntryId).toBe(entries[0].id);
  });

  it("finance active, sans compte (absent ou null) : 400, budget resté approuvé, journal vide", async () => {
    for (const extra of [{}, { treasuryAccountId: null }]) {
      const { approved } = await approvedBudget();
      const res = await call("POST", missionBudgetDisbursePath(approved.id), "logistics", { ...seen(approved), ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
      const [row] = await db.select().from(missionBudgets).where(eq(missionBudgets.id, approved.id));
      expect(row).toMatchObject({ status: "approved", disbursedBy: null, treasuryEntryId: null });
      expect(await entriesOf(approved.id)).toHaveLength(0);
    }
  });

  it("le secrétariat décaisse aussi ; la direction, qui approuve, est refusée (403)", async () => {
    const { approved } = await approvedBudget();
    expect((await call("POST", missionBudgetDisbursePath(approved.id), "management", { ...seen(approved), treasuryAccountId: accounts.bank })).status).toBe(403);
    const res = await call("POST", missionBudgetDisbursePath(approved.id), "secretary", { ...seen(approved), treasuryAccountId: accounts.bank });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "disbursed", disbursedBy: userIds.get("secretary") });
    // Qui décaisse relit le budget.
    const detail = await call("GET", `${MISSION_BUDGETS_PATH}/${approved.id}`, "secretary");
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ id: approved.id, status: "disbursed" });
  });

  it("carte carburant 400, compte désactivé 409, compte inconnu 404 : budget resté approuvé, journal vide", async () => {
    const cases: Array<[number, number]> = [[accounts.card, 400], [accounts.inactive, 409], [2_000_000_000, 404]];
    for (const [treasuryAccountId, status] of cases) {
      const { approved } = await approvedBudget();
      const res = await call("POST", missionBudgetDisbursePath(approved.id), "logistics", { ...seen(approved), treasuryAccountId });
      expect(res.status, String(treasuryAccountId)).toBe(status);
      // L'UPDATE conditionnel précède le refus : la transaction l'annule.
      const [row] = await db.select().from(missionBudgets).where(eq(missionBudgets.id, approved.id));
      expect(row).toMatchObject({ status: "approved", disbursedBy: null, treasuryEntryId: null });
      expect(await entriesOf(approved.id)).toHaveLength(0);
    }
  });

  it("l'approbation refuse un compte (400) ; un identifiant de compte hors plage est refusé (400)", async () => {
    const missionId = await newMission();
    const created = missionBudgetSchema.parse((await call("POST", MISSION_BUDGETS_PATH, "logistics", body(missionId))).body);
    expect((await call("POST", missionBudgetApprovePath(created.id), "management", { ...seen(created), treasuryAccountId: accounts.bank })).status).toBe(400);
    const { approved } = await approvedBudget();
    expect((await call("POST", missionBudgetDisbursePath(approved.id), "logistics", { ...seen(approved), treasuryAccountId: 2_147_483_648 })).status).toBe(400);
  });

  const cancelMission = (missionId: number) => call("PUT", `/api/missions/${missionId}/status`, "admin", { status: "cancelled" });

  it("L1d — mission annulée après décaissement : le reliquat revient au compte source, une fois", async () => {
    const { missionId, approved } = await approvedBudget();
    const res = await call("POST", missionBudgetDisbursePath(approved.id), "logistics", { ...seen(approved), treasuryAccountId: accounts.bank });
    expect(res.status).toBe(200);
    const cancelled = await cancelMission(missionId);
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    const [{ cancelledAt }] = await db.select({ cancelledAt: missions.cancelledAt }).from(missions).where(eq(missions.id, missionId));
    expect(cancelledAt).not.toBeNull();

    const entries = await entriesOf(approved.id);
    expect(entries).toHaveLength(4);
    const byKey = new Map(entries.map((e) => [e.requestKey, e]));
    for (const line of ["fdr", "carburant"]) {
      const out = byKey.get(`mission-budget:${approved.id}:${line}`)!;
      const back = byKey.get(`mission-budget:${approved.id}:${line}:reverse`)!;
      // Aucune dépense justifiée aujourd'hui : reliquat = montant décaissé.
      expect(back, line).toMatchObject({ accountId: accounts.bank, direction: "in", amount: out.amount, category: out.category, missionId, createdBy: userIds.get("admin") });
    }
    // Le budget reste décaissé, figé avec sa mission.
    const [row] = await db.select().from(missionBudgets).where(eq(missionBudgets.id, approved.id));
    expect(row.status).toBe("disbursed");

    // Rejeu de l'annulation (route rejouable) puis du service : rien de plus au journal, date d'annulation inchangée.
    expect((await cancelMission(missionId)).status).toBe(200);
    await db.transaction((tx) => onMissionStatusChange(tx, missionId, "cancelled", userIds.get("admin")!));
    expect(await entriesOf(approved.id)).toHaveLength(4);
    const [replayed] = await db.select({ cancelledAt: missions.cancelledAt }).from(missions).where(eq(missions.id, missionId));
    expect(replayed.cancelledAt).toEqual(cancelledAt);
  });

  /** Mission livrée, budget décaissé au journal : le cas où clôture et annulation se disputent l'argent. */
  async function deliveredDisbursed() {
    const { missionId, approved } = await approvedBudget();
    expect((await call("POST", missionBudgetDisbursePath(approved.id), "logistics", { ...seen(approved), treasuryAccountId: accounts.bank })).status).toBe(200);
    await db.update(missions).set({ status: "delivered" }).where(eq(missions.id, missionId));
    return { missionId, approved };
  }
  const reversalsOf = async (budgetId: number) => (await entriesOf(budgetId)).filter((e) => e.requestKey.endsWith(":reverse"));
  const statusOf = async (missionId: number) =>
    (await db.select({ status: missions.status }).from(missions).where(eq(missions.id, missionId)))[0].status;

  it("L1d — clôture et annulation simultanées d'une mission livrée : une seule passe, l'argent suit le gagnant", async () => {
    const { missionId, approved } = await deliveredDisbursed();
    const results = await Promise.all(
      ["completed", "cancelled"].map((status) => call("PUT", `/api/missions/${missionId}/status`, "admin", { status })),
    );
    expect(results.filter((r) => r.status === 200), JSON.stringify(results)).toHaveLength(1);
    const final = await statusOf(missionId);
    expect(["completed", "cancelled"]).toContain(final);
    expect(await reversalsOf(approved.id)).toHaveLength(final === "cancelled" ? 2 : 0);
  });

  it("L1d — clôture passée entre la lecture et l'écriture de l'annulation : 409, rien n'est contre-passé", async () => {
    const { missionId, approved } = await deliveredDisbursed();
    let pending!: ReturnType<typeof cancelMission>;
    await db.transaction(async (tx) => {
      // La clôture concurrente tient la ligne : l'annulation a lu « delivered » et attend son UPDATE.
      await tx.select({ id: missions.id }).from(missions).where(eq(missions.id, missionId)).for("update");
      pending = cancelMission(missionId);
      let waiting = 0;
      for (let i = 0; i < 200 && waiting === 0; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const res = await db.execute(sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE 'update "missions"%'`);
        waiting = Number((res.rows[0] as { n: number }).n);
      }
      expect(waiting, "l'annulation n'a pas atteint son UPDATE").toBeGreaterThan(0);
      await tx.update(missions).set({ status: "completed", completedAt: new Date() }).where(eq(missions.id, missionId));
    });
    const res = await pending;
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(await statusOf(missionId)).toBe("completed");
    expect(await reversalsOf(approved.id)).toHaveLength(0);
  });

  it("L1d — drapeau finance coupé après un décaissement au journal : l'annulation contre-passe quand même", async () => {
    const { missionId, approved } = await approvedBudget();
    expect((await call("POST", missionBudgetDisbursePath(approved.id), "logistics", { ...seen(approved), treasuryAccountId: accounts.bank })).status).toBe(200);
    process.env.FEATURE_FLAGS = "finance=off";
    try {
      expect((await cancelMission(missionId)).status).toBe(200);
    } finally {
      process.env.FEATURE_FLAGS = "finance=on";
    }
    expect(await reversalsOf(approved.id)).toHaveLength(2);
  });

  it("L1d — annulation avant décaissement, ou budget décaissé avant L1c (sans écriture) : aucun mouvement", async () => {
    const before = await approvedBudget();
    expect((await cancelMission(before.missionId)).status).toBe(200);
    expect(await entriesOf(before.approved.id)).toHaveLength(0);
    const [stillApproved] = await db.select().from(missionBudgets).where(eq(missionBudgets.id, before.approved.id));
    expect(stillApproved.status).toBe("approved");

    // Rétroactif : un budget décaissé avant L1c n'a aucune ligne au journal, rien à contre-passer.
    const legacy = await approvedBudget();
    await db
      .update(missionBudgets)
      .set({ status: "disbursed", disbursedBy: userIds.get("admin")!, disbursedAt: new Date() })
      .where(eq(missionBudgets.id, legacy.approved.id));
    expect((await cancelMission(legacy.missionId)).status).toBe(200);
    expect(await entriesOf(legacy.approved.id)).toHaveLength(0);
  });

  it("L1d — un autre statut que l'annulation ne contre-passe rien", async () => {
    const { missionId, approved } = await approvedBudget();
    expect((await call("POST", missionBudgetDisbursePath(approved.id), "logistics", { ...seen(approved), treasuryAccountId: accounts.cash })).status).toBe(200);
    for (const status of ["planned", "in_progress", "delivered", "completed"]) {
      await db.transaction((tx) => onMissionStatusChange(tx, missionId, status, userIds.get("admin")!));
    }
    expect((await entriesOf(approved.id)).filter((e) => e.requestKey.endsWith(":reverse"))).toHaveLength(0);
  });

  it("drapeau finance coupé : un compte demandé est refusé (409), sans compte rien n'est écrit", async () => {
    const { approved } = await approvedBudget();
    const [row] = await db.select().from(missionBudgets).where(eq(missionBudgets.id, approved.id));
    process.env.FEATURE_FLAGS = "finance=off";
    try {
      await expect(db.transaction((tx) => linkMissionBudgetDisbursement(tx as never, row, accounts.bank, userIds.get("admin")!))).rejects.toMatchObject({ status: 409 });
      expect(await db.transaction((tx) => linkMissionBudgetDisbursement(tx as never, row, null, userIds.get("admin")!))).toBeNull();
    } finally {
      process.env.FEATURE_FLAGS = "finance=on";
    }
    expect(await entriesOf(approved.id)).toHaveLength(0);
  });
});
