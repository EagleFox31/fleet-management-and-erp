import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { db } from "../server/db";
import { clients, fuelPrices, missionBudgetExpenses, missionBudgets, missions, treasuryAccounts, users } from "../shared/schema";
import { isoDateInZone } from "../shared/contracts/kpi-period";
import { cleanupCreated, createIdBag, deleteTreasuryEntriesOfMissions } from "../tests/support/cleanup";
import { createTestClient, createTestUser, TEST_USER_PASSWORD } from "../tests/support/factories";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { newE2EContext } from "./helpers/contexts";

/**
 * L1f : panneau « Budget » de la fiche mission, joué par quatre rôles.
 *
 * La logistique saisit, la direction approuve, le secrétariat décaisse depuis une banque puis
 * justifie une dépense ; le technicien n'a pas l'onglet. Le temps réel est prouvé par la trame
 * `mission_budget_updated` reçue par un second compte, pas par l'écran : la fiche mission a un
 * polling, une assertion d'écran seule pourrait être satisfaite par lui.
 *
 * Captures de chaque vue dans `E2E_CAPTURE_DIR` si la variable est posée (livraison), sinon
 * dans le dossier de sortie du test.
 *
 * Données préfixées E2E-MBUD-, supprimées en fin de spec (et à l'ouverture si un run a planté).
 */

const PREFIX = "E2E-MBUD-";
const ids = createIdBag();
let stamp = 0;
const token = (label: string) => `${PREFIX}${label}-${Date.now().toString(36)}-${++stamp}`;
const DAY = isoDateInZone(new Date());

type Account = E2ECredentials & { id: number };
const accounts: Record<"logistics" | "management" | "secretary" | "technician", Account> = {} as never;
let missionId: number;
let insertedPrice = false;

async function purge(): Promise<void> {
  const missionIds = (await db.select({ id: missions.id }).from(missions).where(like(missions.orderNumber, `${PREFIX}%`))).map((r) => r.id);
  if (missionIds.length > 0) {
    const budgetIds = (await db.select({ id: missionBudgets.id }).from(missionBudgets).where(inArray(missionBudgets.missionId, missionIds))).map((r) => r.id);
    if (budgetIds.length > 0) await db.delete(missionBudgetExpenses).where(inArray(missionBudgetExpenses.budgetId, budgetIds));
    await db.delete(missionBudgets).where(inArray(missionBudgets.missionId, missionIds));
    await deleteTreasuryEntriesOfMissions(missionIds);
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  const bag = createIdBag();
  bag.clientIds.push(...(await db.select({ id: clients.id }).from(clients).where(like(clients.name, `${PREFIX}%`))).map((r) => r.id));
  bag.userIds.push(...(await db.select({ id: users.id }).from(users).where(like(users.username, `${PREFIX}%`))).map((r) => r.id));
  await cleanupCreated(bag);
}

async function capture(page: Page, name: string): Promise<void> {
  const file = test.info().outputPath(`${name}.png`);
  // Pleine page depuis le haut : prise après défilement, elle superpose l'en-tête collant.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: file, fullPage: true });
  const dir = process.env.E2E_CAPTURE_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    copyFileSync(file, join(dir, `l1f-${name}.png`));
  }
}

/** Contexte connecté, trames /ws capturées avant toute navigation (le socket s'ouvre au montage). */
async function open(browser: Browser, account: Account): Promise<{ context: BrowserContext; page: Page; frames: string[] }> {
  const context = await newE2EContext(browser, account.label);
  const page = await context.newPage();
  const frames: string[] = [];
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/ws")) return;
    ws.on("framereceived", (f) => frames.push(typeof f.payload === "string" ? f.payload : f.payload.toString()));
  });
  await loginWithSession(page, account);
  return { context, page, frames };
}

async function openBudgetTab(page: Page): Promise<void> {
  await page.goto(`/missions/${missionId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Budget" }).click();
  await expect(page.getByTestId("mission-budget-panel")).toBeVisible({ timeout: 60_000 });
}

/** Trame de budget pour cette mission et ce statut, reçue par ce compte. */
const budgetFrame = (frames: string[], status: string) =>
  frames.some((f) => f.includes("mission_budget_updated") && f.includes(`"missionId":${missionId}`) && f.includes(`"status":"${status}"`));

async function chooseOption(page: Page, trigger: string, option: RegExp | string): Promise<void> {
  await page.getByTestId(trigger).click();
  await page.getByRole("option", { name: option }).click();
}

test.beforeAll(async () => {
  await purge();
  for (const role of ["logistics", "management", "secretary", "technician"] as const) {
    const name = token(role.toUpperCase());
    const user = await createTestUser({ role, username: name, name, email: `${name.toLowerCase()}@fleet.test` });
    ids.userIds.push(user.id);
    accounts[role] = { id: user.id, username: user.username, password: TEST_USER_PASSWORD, label: role };
  }
  const client = await createTestClient({ name: token("CLIENT") });
  ids.clientIds.push(client.id);
  const [mission] = await db
    .insert(missions)
    .values({ clientId: client.id, orderNumber: token("MIS"), status: "planned", pickupAddress: "Douala, port", deliveryAddress: "Yaoundé, entrepôt", createdBy: accounts.logistics.id })
    .returning();
  missionId = mission.id;
  // Prix du jour : posé seulement s'il manque, et retiré en fin de spec dans ce seul cas.
  const inserted = await db.insert(fuelPrices).values({ effectiveFrom: DAY, pricePerLiter: "840" }).onConflictDoNothing().returning({ id: fuelPrices.id });
  insertedPrice = inserted.length > 0;
  // Compte source du décaissement, créé au nom du secrétariat : le ménage des comptes de test le supprime.
  await db.insert(treasuryAccounts).values({
    code: token("BQ"),
    label: `${PREFIX}Banque`,
    kind: "bank",
    openingBalance: "10000000",
    openingDate: DAY,
    createdBy: accounts.secretary.id,
    updatedBy: accounts.secretary.id,
  });
});

test.afterAll(async () => {
  await purge();
  await cleanupCreated(ids);
  if (insertedPrice) await db.delete(fuelPrices).where(eq(fuelPrices.effectiveFrom, DAY));
});

test.describe("L1f : budget de mission sur la fiche mission", () => {
  test.setTimeout(240_000);

  test("saisie, approbation, décaissement, dépense : chaque rôle son étape, la trame atteint l'autre compte", async ({ browser }) => {
    const logistics = await open(browser, accounts.logistics);
    const management = await open(browser, accounts.management);
    try {
      await openBudgetTab(logistics.page);
      await openBudgetTab(management.page);
      await expect(management.page.getByTestId("mission-budget-empty")).toBeVisible();
      await expect(management.page.getByTestId("button-mission-budget-edit"), "la direction ne saisit pas").toHaveCount(0);

      // Logistique : saisie libre.
      await logistics.page.getByTestId("button-mission-budget-edit").click();
      await logistics.page.getByLabel("Carburant (L)").fill("200");
      await logistics.page.getByLabel("FDR (FCFA)").fill("50000");
      await logistics.page.getByLabel("Frais annexes (FCFA)").fill("10000");
      await logistics.page.getByTestId("button-mission-budget-save").click();
      await expect(logistics.page.getByTestId("mission-budget-status")).toHaveText("Demandé");
      await expect(logistics.page.getByTestId("button-mission-budget-approve"), "qui saisit n'approuve pas").toHaveCount(0);

      // Direction : la trame arrive, l'écran suit, elle approuve.
      await expect.poll(() => budgetFrame(management.frames, "requested"), { timeout: 15_000 }).toBe(true);
      await expect(management.page.getByTestId("mission-budget-status")).toHaveText("Demandé");
      await capture(logistics.page, "1-logistique-saisie");
      await management.page.getByTestId("button-mission-budget-approve").click();
      await expect(management.page.getByTestId("mission-budget-status")).toHaveText("Approuvé");
      await expect(management.page.getByTestId("button-mission-budget-disburse"), "qui approuve ne décaisse pas").toHaveCount(0);
      await capture(management.page, "2-direction-approbation");

      // Logistique : reçoit l'approbation par la trame.
      await expect.poll(() => budgetFrame(logistics.frames, "approved"), { timeout: 15_000 }).toBe(true);
      await expect(logistics.page.getByTestId("mission-budget-status")).toHaveText("Approuvé");
    } finally {
      await logistics.context.close();
      await management.context.close();
    }

    // Secrétariat : décaisse depuis la banque, puis justifie une dépense.
    const secretary = await open(browser, accounts.secretary);
    try {
      await openBudgetTab(secretary.page);
      await secretary.page.getByTestId("button-mission-budget-disburse").click();
      await chooseOption(secretary.page, "select-mission-budget-account", new RegExp(`${PREFIX}Banque`));
      await secretary.page.getByTestId("button-mission-budget-disburse-confirm").click();
      await expect(secretary.page.getByTestId("mission-budget-status")).toHaveText("Décaissé");
      await expect(secretary.page.getByTestId("mission-budget-expenses")).toBeVisible();

      await secretary.page.getByTestId("button-mission-budget-add-expense").click();
      await chooseOption(secretary.page, "select-mission-budget-expense-line", "FDR et frais annexes");
      await secretary.page.getByLabel("Libellé").fill(`${PREFIX}péage`);
      await secretary.page.getByLabel("Montant (FCFA)").fill("15000");
      await secretary.page.getByTestId("button-mission-budget-expense-save").click();
      const fdr = secretary.page.getByTestId("mission-budget-line-fdr");
      await expect(fdr).toContainText(/15\s000/);
      await expect(secretary.page.getByTestId("mission-budget-expenses")).toContainText(`${PREFIX}péage`);
      await capture(secretary.page, "3-secretariat-decaissement-depense");
    } finally {
      await secretary.context.close();
    }
  });

  test("technicien : ni onglet Budget ni panneau", async ({ browser }) => {
    const technician = await open(browser, accounts.technician);
    try {
      await technician.page.goto(`/missions/${missionId}`, { waitUntil: "domcontentloaded" });
      await expect(technician.page.getByRole("tab").first()).toBeVisible({ timeout: 60_000 });
      await expect(technician.page.getByRole("tab", { name: "Budget" })).toHaveCount(0);
      await expect(technician.page.getByTestId("mission-budget-panel")).toHaveCount(0);
      await capture(technician.page, "4-technicien-sans-panneau");
    } finally {
      await technician.context.close();
    }
  });
});
