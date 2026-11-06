import { createServer, type Server } from "http";
import { eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MISSION_BUDGETS_PATH,
  missionBudgetApprovePath,
  missionBudgetDisbursePath,
  missionBudgetExpensePath,
  missionBudgetExpenseSchema,
  missionBudgetExpensesPath,
  missionBudgetExpensesResponseSchema,
  missionBudgetSchema,
} from "../../shared/contracts/mission-budgets";
import { isoDateInZone } from "../../shared/contracts/kpi-period";
import { addDaysToIsoDate } from "../../shared/constants/document-renewal-statuses";
import { fuelPrices, missionBudgetExpenses, missionBudgets, missions, treasuryAccounts, treasuryEntries } from "../../shared/schema";
import { db } from "../../server/db";
import { reverseMissionBudgetDisbursements } from "../../server/services/treasury-links";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { TEST_PREFIX } from "../support/ids";

/** Niveau C, L1e : dépenses justifiées d'un budget décaissé (drapeau finance), plafond, verrous, contre-passation. */
const previousFlags = process.env.FEATURE_FLAGS;
const ROLES = ["admin", "logistics", "management", "secretary", "technician", "driver", "client"] as const;
const TODAY = isoDateInZone(new Date());
// Date propre à ce fichier (fenêtre ± 60 j) : prix du jour posé puis restauré.
const DAY = addDaysToIsoDate(TODAY, 43);
const PRICE = 1000;
// body() : FDR 40 000 + frais annexes 5 000 ; carburant 200 L × 1 000.
const FDR = 45_000;
const FUEL = 200_000;

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
const userIds = new Map<string, number>();
const missionIds: number[] = [];
const treasuryAccountIds: number[] = [];
let previousPrice: string | null = null;
let bank = 0;

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

const seen = (b: { updatedAt: string }) => ({ expectedUpdatedAt: b.updatedAt });

async function approvedBudget() {
  const [m] = await db
    .insert(missions)
    .values({ orderNumber: `${TEST_PREFIX}mbe-${Date.now()}-${missionIds.length}`, pickupAddress: "Douala", deliveryAddress: "Kribi", createdBy: userIds.get("logistics")! })
    .returning({ id: missions.id });
  missionIds.push(m.id);
  const created = missionBudgetSchema.parse(
    (await call("POST", MISSION_BUDGETS_PATH, "logistics", { missionId: m.id, budgetDate: DAY, fuelLiters: 200, fdrAmount: 40_000, extrasAmount: 5_000 })).body,
  );
  const approved = missionBudgetSchema.parse((await call("POST", missionBudgetApprovePath(created.id), "management", seen(created))).body);
  return { missionId: m.id, approved };
}

async function disbursedBudget() {
  const { missionId, approved } = await approvedBudget();
  const res = await call("POST", missionBudgetDisbursePath(approved.id), "logistics", { ...seen(approved), treasuryAccountId: bank });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { missionId, budgetId: approved.id };
}

const expense = (line: "fdr" | "carburant", amount: number, extra: Record<string, unknown> = {}) => ({ line, amount, label: "Péage Edéa", ...extra });
const addExpense = (budgetId: number, body: unknown, role = "logistics") => call("POST", missionBudgetExpensesPath(budgetId), role, body);
const cancelMission = (missionId: number) => call("PUT", `/api/missions/${missionId}/status`, "admin", { status: "cancelled" });
const reversalsOf = (budgetId: number) =>
  db.select().from(treasuryEntries).where(like(treasuryEntries.requestKey, `mission-budget:${budgetId}:%:reverse`));

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "finance=on";
  (global as any).broadcastUpdate = () => {};
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of ROLES) await login(role);
  const [existing] = await db.select().from(fuelPrices).where(eq(fuelPrices.effectiveFrom, DAY));
  previousPrice = existing ? existing.pricePerLiter : null;
  await db
    .insert(fuelPrices)
    .values({ effectiveFrom: DAY, pricePerLiter: String(PRICE), createdBy: userIds.get("admin")! })
    .onConflictDoUpdate({ target: fuelPrices.effectiveFrom, set: { pricePerLiter: String(PRICE) } });
  const [account] = await db
    .insert(treasuryAccounts)
    .values({ code: `${TEST_PREFIX}mbe-bank-${Date.now()}`, label: `${TEST_PREFIX} banque`, kind: "bank", createdBy: userIds.get("admin")! })
    .returning({ id: treasuryAccounts.id });
  bank = account.id;
  treasuryAccountIds.push(bank);
}, 180000);

afterAll(async () => {
  if (missionIds.length) {
    const budgetIds = db.select({ id: missionBudgets.id }).from(missionBudgets).where(inArray(missionBudgets.missionId, missionIds));
    await db.delete(missionBudgetExpenses).where(inArray(missionBudgetExpenses.budgetId, budgetIds));
    await db.delete(missionBudgets).where(inArray(missionBudgets.missionId, missionIds));
    await db.delete(treasuryEntries).where(inArray(treasuryEntries.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (treasuryAccountIds.length) await db.delete(treasuryAccounts).where(inArray(treasuryAccounts.id, treasuryAccountIds));
  if (previousPrice === null) await db.delete(fuelPrices).where(eq(fuelPrices.effectiveFrom, DAY));
  else await db.update(fuelPrices).set({ pricePerLiter: previousPrice }).where(eq(fuelPrices.effectiveFrom, DAY));
  await cleanupCreated(ids);
  delete (global as any).broadcastUpdate;
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  await new Promise<void>((r) => server.close(() => r()));
});

describe("Dépenses justifiées du budget de mission (L1e)", { timeout: 120000 }, () => {
  it("saisie par qui décaisse, lecture par qui lit le budget ; autres rôles 403, anonyme 401", async () => {
    const { budgetId } = await disbursedBudget();
    const created = await addExpense(budgetId, expense("fdr", 12_000, { expenseDate: TODAY }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(missionBudgetExpenseSchema.parse(created.body)).toMatchObject({ budgetId, line: "fdr", amount: 12_000, expenseDate: TODAY, createdBy: userIds.get("logistics") });

    for (const role of ["admin", "secretary"]) expect((await addExpense(budgetId, expense("carburant", 1_000), role)).status, role).toBe(201);
    for (const role of ["management", "technician", "driver", "client"]) expect((await addExpense(budgetId, expense("fdr", 1), role)).status, role).toBe(403);
    expect((await call("POST", missionBudgetExpensesPath(budgetId), undefined, expense("fdr", 1))).status).toBe(401);

    for (const role of ["admin", "logistics", "management", "secretary"]) {
      expect((await call("GET", missionBudgetExpensesPath(budgetId), role)).status, role).toBe(200);
    }
    for (const role of ["technician", "driver", "client"]) expect((await call("GET", missionBudgetExpensesPath(budgetId), role)).status, role).toBe(403);

    const list = missionBudgetExpensesResponseSchema.parse((await call("GET", missionBudgetExpensesPath(budgetId), "management")).body);
    expect(list.expenses).toHaveLength(3);
    expect(list.lines).toEqual([
      { line: "fdr", disbursed: FDR, justified: 12_000, remaining: FDR - 12_000 },
      { line: "carburant", disbursed: FUEL, justified: 2_000, remaining: FUEL - 2_000 },
    ]);
  });

  it("corps invalide (montant non entier, nul, ligne inconnue, champ en trop, libellé vide) : 400 ; date par défaut = jour de Douala", async () => {
    const { budgetId } = await disbursedBudget();
    const invalid = [
      expense("fdr", 10.5),
      expense("fdr", 0),
      { ...expense("fdr", 10), line: "extras" },
      { ...expense("fdr", 10), createdBy: 1 },
      expense("fdr", 10, { label: "   " }),
      expense("fdr", 10, { expenseDate: addDaysToIsoDate(TODAY, 1) }),
    ];
    for (const body of invalid) expect((await addExpense(budgetId, body)).status, JSON.stringify(body)).toBe(400);
    const res = await addExpense(budgetId, expense("fdr", 10));
    expect(res.status).toBe(201);
    expect(res.body.expenseDate).toBe(TODAY);
  });

  it("date du lendemain à Douala : 400, rien n'est écrit", async () => {
    const { budgetId } = await disbursedBudget();
    const tomorrow = addDaysToIsoDate(isoDateInZone(new Date()), 1);
    const res = await addExpense(budgetId, expense("fdr", 1_000, { expenseDate: tomorrow }));
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(await db.select().from(missionBudgetExpenses).where(eq(missionBudgetExpenses.budgetId, budgetId))).toHaveLength(0);
  });

  it("date antérieure au jour du décaissement : 400 ; le jour même passe ; budget sans date de décaissement : pas de borne", async () => {
    const { budgetId } = await disbursedBudget();
    const [{ disbursedAt }] = await db.select({ disbursedAt: missionBudgets.disbursedAt }).from(missionBudgets).where(eq(missionBudgets.id, budgetId));
    const day = isoDateInZone(disbursedAt!);
    const before = await addExpense(budgetId, expense("fdr", 1_000, { expenseDate: addDaysToIsoDate(day, -1) }));
    expect(before.status, JSON.stringify(before.body)).toBe(400);
    expect((await addExpense(budgetId, expense("fdr", 1_000, { expenseDate: day }))).status).toBe(201);
    // Budget décaissé avant que la date ne soit tenue : aucune borne basse.
    await db.update(missionBudgets).set({ disbursedAt: null }).where(eq(missionBudgets.id, budgetId));
    expect((await addExpense(budgetId, expense("fdr", 1_000, { expenseDate: addDaysToIsoDate(day, -30) }))).status).toBe(201);
  });

  it("budget non décaissé : 409 ; budget inconnu : 404", async () => {
    const { approved } = await approvedBudget();
    expect((await addExpense(approved.id, expense("fdr", 1_000))).status).toBe(409);
    expect((await addExpense(2_000_000_000, expense("fdr", 1_000))).status).toBe(404);
    expect((await call("GET", missionBudgetExpensesPath(2_000_000_000), "admin")).status).toBe(404);
  });

  it("somme ≤ décaissé de la ligne : le dépassement est refusé (409), le juste reste passe", async () => {
    const { budgetId } = await disbursedBudget();
    expect((await addExpense(budgetId, expense("fdr", 40_000))).status).toBe(201);
    const over = await addExpense(budgetId, expense("fdr", 5_001));
    expect(over.status).toBe(409);
    expect(over.body.message).toMatch(/5\s000 FCFA/);
    expect((await addExpense(budgetId, expense("fdr", 5_000))).status).toBe(201);
    // Les lignes ont chacune leur plafond.
    expect((await addExpense(budgetId, expense("carburant", FUEL))).status).toBe(201);
    expect((await addExpense(budgetId, expense("carburant", 1))).status).toBe(409);
  });

  it("deux saisies simultanées ne dépassent pas le décaissé (budget FOR UPDATE)", async () => {
    const { budgetId } = await disbursedBudget();
    const results = await Promise.all([30_000, 30_000, 30_000].map((amount) => addExpense(budgetId, expense("fdr", amount))));
    expect(results.filter((r) => r.status === 201), JSON.stringify(results)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    const list = missionBudgetExpensesResponseSchema.parse((await call("GET", missionBudgetExpensesPath(budgetId), "admin")).body);
    expect(list.lines[0].justified).toBe(30_000);
  });

  it("saisie concurrente non encore validée : la seconde attend le verrou du budget, puis voit la somme (409)", async () => {
    const { budgetId } = await disbursedBudget();
    let pending!: ReturnType<typeof addExpense>;
    await db.transaction(async (tx) => {
      // Une saisie concurrente tient le budget et a inséré sans valider : la somme qu'elle porte est encore invisible.
      await tx.select({ id: missionBudgets.id }).from(missionBudgets).where(eq(missionBudgets.id, budgetId)).for("update");
      await tx.insert(missionBudgetExpenses).values({ budgetId, line: "fdr", amount: 30_000, label: "concurrente", expenseDate: TODAY, createdBy: userIds.get("admin")! });
      pending = addExpense(budgetId, expense("fdr", 30_000));
      let waiting = 0;
      for (let i = 0; i < 200 && waiting === 0; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const res = await db.execute(
          sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%from "mission_budgets"%for update%'`,
        );
        waiting = Number((res.rows[0] as { n: number }).n);
      }
      expect(waiting, "la saisie n'attend pas le verrou du budget").toBeGreaterThan(0);
    });
    const res = await pending;
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    const list = missionBudgetExpensesResponseSchema.parse((await call("GET", missionBudgetExpensesPath(budgetId), "admin")).body);
    expect(list.lines[0].justified).toBe(30_000);
  });

  it("suppression douce : ligne conservée, exclue de la somme, rejouable ; dépense d'un autre budget 404", async () => {
    const { budgetId } = await disbursedBudget();
    const other = await disbursedBudget();
    const created = missionBudgetExpenseSchema.parse((await addExpense(budgetId, expense("fdr", FDR))).body);
    expect((await call("DELETE", missionBudgetExpensePath(other.budgetId, created.id), "logistics")).status).toBe(404);
    expect((await call("DELETE", missionBudgetExpensePath(budgetId, created.id), "management")).status).toBe(403);

    expect((await call("DELETE", missionBudgetExpensePath(budgetId, created.id), "secretary")).status).toBe(204);
    const [row] = await db.select().from(missionBudgetExpenses).where(eq(missionBudgetExpenses.id, created.id));
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedBy).toBe(userIds.get("secretary"));
    // Rejeu : no-op, auteur et date de suppression inchangés.
    expect((await call("DELETE", missionBudgetExpensePath(budgetId, created.id), "admin")).status).toBe(204);
    const [again] = await db.select().from(missionBudgetExpenses).where(eq(missionBudgetExpenses.id, created.id));
    expect(again).toMatchObject({ deletedBy: userIds.get("secretary"), deletedAt: row.deletedAt });

    const list = missionBudgetExpensesResponseSchema.parse((await call("GET", missionBudgetExpensesPath(budgetId), "admin")).body);
    expect(list.expenses).toHaveLength(0);
    expect(list.lines[0]).toMatchObject({ justified: 0, remaining: FDR });
    // Le plafond est libéré par la suppression.
    expect((await addExpense(budgetId, expense("fdr", FDR))).status).toBe(201);
  });

  it("mission annulée : seul le reliquat revient au compte ; dépenses ensuite figées (409)", async () => {
    const { missionId, budgetId } = await disbursedBudget();
    expect((await addExpense(budgetId, expense("fdr", 15_000))).status).toBe(201);
    const deleted = missionBudgetExpenseSchema.parse((await addExpense(budgetId, expense("fdr", 10_000))).body);
    expect((await call("DELETE", missionBudgetExpensePath(budgetId, deleted.id), "logistics")).status).toBe(204);
    expect((await addExpense(budgetId, expense("carburant", FUEL))).status).toBe(201);

    expect((await cancelMission(missionId)).status).toBe(200);
    const reversals = await reversalsOf(budgetId);
    // FDR : 45 000 − 15 000 (la dépense supprimée ne compte pas) ; carburant entièrement justifié : aucune ligne.
    expect(reversals.map((e) => [e.requestKey, e.amount])).toEqual([[`mission-budget:${budgetId}:fdr:reverse`, "30000.00"]]);

    const live = missionBudgetExpenseSchema.parse((await call("GET", missionBudgetExpensesPath(budgetId), "admin")).body.expenses[0]);
    expect((await addExpense(budgetId, expense("fdr", 1))).status).toBe(409);
    expect((await call("DELETE", missionBudgetExpensePath(budgetId, live.id), "logistics")).status).toBe(409);
  });

  const complete = (missionId: number) =>
    db.update(missions).set({ status: "completed", completedAt: new Date() }).where(eq(missions.id, missionId));

  it("mission terminée, reliquat non rendu (R1) : saisie et suppression ouvertes, plafond du décaissé maintenu", async () => {
    const { missionId, budgetId } = await disbursedBudget();
    const before = missionBudgetExpenseSchema.parse((await addExpense(budgetId, expense("fdr", 1_000))).body);
    await complete(missionId);
    const after = await addExpense(budgetId, expense("fdr", 2_000));
    expect(after.status, JSON.stringify(after.body)).toBe(201);
    expect((await call("DELETE", missionBudgetExpensePath(budgetId, before.id), "logistics")).status).toBe(204);
    expect((await addExpense(budgetId, expense("fdr", FDR))).status, "au-delà du décaissé").toBe(409);
    const lines = missionBudgetExpensesResponseSchema.parse((await call("GET", missionBudgetExpensesPath(budgetId), "admin")).body).lines;
    expect(lines.find((l) => l.line === "fdr")?.justified).toBe(2_000);
  });

  it("mission terminée, reliquat rendu : saisie et suppression refusées (409)", async () => {
    const { missionId, budgetId } = await disbursedBudget();
    const created = missionBudgetExpenseSchema.parse((await addExpense(budgetId, expense("fdr", 1_000))).body);
    await complete(missionId);
    // Aucun écran ne rend encore le reliquat d'une mission terminée : contre-passation par le service réel.
    expect(await db.transaction((tx) => reverseMissionBudgetDisbursements(tx as never, [budgetId], null))).toBeGreaterThan(0);
    const refused = await addExpense(budgetId, expense("fdr", 1_000));
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe("Le reliquat de ce budget a été rendu au compte source : ses dépenses ne changent plus.");
    expect((await call("DELETE", missionBudgetExpensePath(budgetId, created.id), "logistics")).status).toBe(409);
  });

  it("mission annulée, même sans contre-passation : saisie et suppression refusées (409)", async () => {
    const { missionId, budgetId } = await disbursedBudget();
    const created = missionBudgetExpenseSchema.parse((await addExpense(budgetId, expense("fdr", 1_000))).body);
    // Statut posé hors parcours : prouve que le refus tient au statut, pas seulement à la contre-passation.
    await db.update(missions).set({ status: "cancelled" }).where(eq(missions.id, missionId));
    const refused = await addExpense(budgetId, expense("fdr", 1_000));
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe("Cette mission est annulée : ses dépenses ne changent plus.");
    expect((await call("DELETE", missionBudgetExpensePath(budgetId, created.id), "logistics")).status).toBe(409);
  });

  it("reliquat déjà contre-passé alors que la mission est rouverte : 409", async () => {
    const { missionId, budgetId } = await disbursedBudget();
    expect((await cancelMission(missionId)).status).toBe(200);
    // Mission rouverte hors parcours (correction manuelle) : la contre-passation au journal suffit à figer.
    await db.update(missions).set({ status: "planned" }).where(eq(missions.id, missionId));
    expect((await addExpense(budgetId, expense("fdr", 1_000))).status).toBe(409);
  });

  it("drapeau finance coupé : 404 sur les trois routes", async () => {
    const { budgetId } = await disbursedBudget();
    process.env.FEATURE_FLAGS = "finance=off";
    try {
      expect((await call("GET", missionBudgetExpensesPath(budgetId), "admin")).status).toBe(404);
      expect((await addExpense(budgetId, expense("fdr", 1), "admin")).status).toBe(404);
      expect((await call("DELETE", missionBudgetExpensePath(budgetId, 1), "admin")).status).toBe(404);
    } finally {
      process.env.FEATURE_FLAGS = "finance=on";
    }
  });
});
