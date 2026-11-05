import { expect, test, type Page } from "@playwright/test";
import { inArray, like } from "drizzle-orm";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { db } from "../server/db";
import { clients, missionBudgets, missions, users } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestClient, createTestUser, TEST_USER_PASSWORD } from "../tests/support/factories";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { newE2EContext } from "./helpers/contexts";

/**
 * L1g : drapeau finance actif, le lancement d'une mission lit le budget de mission.
 *
 * Mission préparée avec l'ancien budget de la fiche, sans budget de mission : « Lancer la mission »
 * n'ouvre plus l'ancienne saisie, un message dit de créer et faire approuver le budget, et l'onglet
 * Budget s'ouvre. L'ancien bouton « Budgets mission » laisse place à « Voir l'onglet Budget ».
 * La direction approuve ensuite le budget depuis sa fiche : la trame `mission_budget_updated` atteint la
 * logistique (autre compte, autre rôle) et sa check-list de lancement est relue sans rechargement,
 * budget désormais conforme.
 *
 * Serveur lancé avec FEATURE_FLAGS=finance=on. Données préfixées E2E-MLB-, purgées en début et fin.
 */

const PREFIX = "E2E-MLB-";
const ids = createIdBag();
let stamp = 0;
const token = (label: string) => `${PREFIX}${label}-${Date.now().toString(36)}-${++stamp}`;
const REFUSAL = "Créer et faire approuver le budget dans l'onglet Budget";

let logistics: E2ECredentials;
let management: E2ECredentials;
let missionId = 0;

async function purge(): Promise<void> {
  const missionIds = (await db.select({ id: missions.id }).from(missions).where(like(missions.orderNumber, `${PREFIX}%`))).map((r) => r.id);
  if (missionIds.length > 0) {
    await db.delete(missionBudgets).where(inArray(missionBudgets.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  const bag = createIdBag();
  bag.clientIds.push(...(await db.select({ id: clients.id }).from(clients).where(like(clients.name, `${PREFIX}%`))).map((r) => r.id));
  bag.userIds.push(...(await db.select({ id: users.id }).from(users).where(like(users.username, `${PREFIX}%`))).map((r) => r.id));
  await cleanupCreated(bag);
}

async function capture(page: Page, name: string): Promise<void> {
  const file = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const dir = process.env.E2E_CAPTURE_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    copyFileSync(file, join(dir, `l1g-${name}.png`));
  }
}

/** Ouvre la fiche et attend la check-list de lancement, que le bouton de lancement consulte. */
async function openMission(page: Page): Promise<void> {
  const readiness = page.waitForResponse((r) => r.url().includes(`/api/missions/${missionId}/launch-readiness`) && r.ok(), { timeout: 60_000 });
  await page.goto(`/missions/${missionId}`, { waitUntil: "domcontentloaded" });
  await readiness;
  await expect(page.getByTestId("button-transition-mission-status-header")).toBeVisible({ timeout: 60_000 });
}

test.beforeAll(async () => {
  await purge();
  const name = token("LOGISTICS");
  const user = await createTestUser({ role: "logistics", username: name, name, email: `${name.toLowerCase()}@fleet.test` });
  ids.userIds.push(user.id);
  logistics = { username: user.username, password: TEST_USER_PASSWORD, label: "logistics" };
  const managerName = token("MANAGEMENT");
  const manager = await createTestUser({ role: "management", username: managerName, name: managerName, email: `${managerName.toLowerCase()}@fleet.test` });
  ids.userIds.push(manager.id);
  management = { username: manager.username, password: TEST_USER_PASSWORD, label: "management" };
  const client = await createTestClient({ name: token("CLIENT") });
  ids.clientIds.push(client.id);
  const [mission] = await db
    .insert(missions)
    .values({
      clientId: client.id,
      orderNumber: token("MIS"),
      status: "planned",
      pickupAddress: "Douala, port",
      deliveryAddress: "Yaoundé, entrepôt",
      createdBy: user.id,
      // Ancien budget complet : il suffisait à lancer avant L1, il ne suffit plus quand la finance est active.
      workflowData: { budgetPlan: { fuelBudget: 111000, roadExpensesBudget: 22000, contingencyBudget: 3000 } },
    } as any)
    .returning({ id: missions.id });
  missionId = mission.id;
});

test.afterAll(async () => {
  await purge();
  await cleanupCreated(ids);
});

test.describe("L1g : lancement sur le budget de mission", () => {
  test.setTimeout(180_000);

  test("sans budget de mission : refus lisible et onglet Budget ; approbation par la direction : check-list relue chez la logistique", async ({ browser }) => {
    const context = await newE2EContext(browser, logistics.label);
    const page = await context.newPage();
    const frames: string[] = [];
    page.on("websocket", (ws) => {
      if (!ws.url().includes("/ws")) return;
      ws.on("framereceived", (f) => frames.push(typeof f.payload === "string" ? f.payload : f.payload.toString()));
    });
    const managerContext = await newE2EContext(browser, management.label);
    const managerPage = await managerContext.newPage();
    try {
      await loginWithSession(page, logistics);
      await openMission(page);

      await expect(page.getByTestId("button-open-mission-budgets"), "ancienne saisie retirée").toHaveCount(0);
      await expect(page.getByTestId("button-go-mission-budget-tab")).toBeVisible();

      await page.getByTestId("button-transition-mission-status-header").click();
      await expect(page.getByText(REFUSAL).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("tab", { name: "Budget" })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("dialog"), "l'ancienne saisie du budget ne s'ouvre plus").toHaveCount(0);
      await capture(page, "1-logistique-lancement-refuse");

      // Budget demandé posé en base (la saisie est couverte par la spec 26), approuvé par la direction dans l'UI.
      await db.insert(missionBudgets).values({
        missionId,
        budgetDate: new Date().toISOString().slice(0, 10),
        fuelLiters: "60",
        fuelUnitPrice: "840",
        fuelAmount: "50400",
        fdrAmount: "20000",
        extrasAmount: "5000",
        totalAmount: "75400",
        status: "requested",
      } as any);
      await loginWithSession(managerPage, management);
      await managerPage.goto(`/missions/${missionId}`, { waitUntil: "domcontentloaded" });
      await managerPage.getByRole("tab", { name: "Budget" }).click();
      const refreshed = page.waitForResponse((r) => r.url().includes(`/api/missions/${missionId}/launch-readiness`) && r.ok(), { timeout: 30_000 });
      await managerPage.getByTestId("button-mission-budget-approve").click();
      await expect(managerPage.getByTestId("mission-budget-status")).toHaveText("Approuvé");

      // Logistique, sans rechargement : la trame arrive, puis la check-list est relue, budget conforme.
      await expect
        .poll(() => frames.some((f) => f.includes("mission_budget_updated") && f.includes(`"missionId":${missionId}`) && f.includes('"status":"approved"')), { timeout: 15_000 })
        .toBe(true);
      const checks = (await (await refreshed).json()).checks as Array<{ key: string; passed: boolean }>;
      expect(checks.filter((c) => c.key.startsWith("budget_")).map((c) => c.passed)).toEqual([true, true, true]);
      await capture(page, "2-logistique-budget-approuve");
    } finally {
      await context.close();
      await managerContext.close();
    }
  });
});
