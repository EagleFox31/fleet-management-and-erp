import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { inArray, like } from "drizzle-orm";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { db } from "../server/db";
import { clients, missionBudgets, missions, users } from "../shared/schema";
import { isoDateInZone } from "../shared/contracts/kpi-period";
import { addDaysToIsoDate } from "../shared/constants/document-renewal-statuses";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestClient, createTestUser, TEST_USER_PASSWORD } from "../tests/support/factories";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { newE2EContext } from "./helpers/contexts";

/**
 * L1f-2 : page « Besoin du jour » (/finance/mission-budgets), lecture seule.
 *
 * Trois budgets sur une date à l'écart du jour courant, pour que les totaux ne dépendent que
 * de cette spec : demandé, approuvé, décaissé. Le secrétariat lit la page ; la direction
 * approuve le budget demandé depuis la fiche mission ; la trame `mission_budget_updated`
 * reçue par le secrétariat prouve le temps réel, puis l'écran suit (reste à décaisser
 * inchangé, un approuvé de plus). Le technicien n'a ni la page ni l'entrée de menu.
 *
 * Captures dans `E2E_CAPTURE_DIR` si la variable est posée, sinon dans le dossier du test.
 * Données préfixées E2E-MBDN-, supprimées en fin de spec (et à l'ouverture si un run a planté).
 */

const PREFIX = "E2E-MBDN-";
const ids = createIdBag();
let stamp = 0;
const token = (label: string) => `${PREFIX}${label}-${Date.now().toString(36)}-${++stamp}`;
// Dans la fenêtre de ± 60 jours des budgets, à l'écart des dates employées par les autres specs.
const DATE = addDaysToIsoDate(isoDateInZone(new Date()), 47);

type Account = E2ECredentials & { id: number };
type Role = "logistics" | "management" | "secretary" | "technician";
const accounts: Record<Role, Account> = {} as never;
const missionOf: Record<"requested" | "approved" | "disbursed", { id: number; orderNumber: string }> = {} as never;

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
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: file, fullPage: true });
  const dir = process.env.E2E_CAPTURE_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    copyFileSync(file, join(dir, `l1f2-${name}.png`));
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

const sidebar = (page: Page) => page.locator('[data-help-target="app-sidebar"]');

async function openDailyNeed(page: Page): Promise<void> {
  await page.goto("/finance/mission-budgets", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("mission-budgets-daily-need")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("input-daily-need-date").fill(DATE);
  await expect(page.getByTestId("daily-need-count")).toContainText("3", { timeout: 30_000 });
}

/** Montant affiché, espaces de milliers normalisés (Intl emploie une espace fine insécable). */
const amount = (n: string) => new RegExp(n.replace(/ /g, "\\s"));

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
  // Montants posés en base : la page est en lecture seule, la saisie est couverte par la spec 26.
  const budgets = {
    requested: { fuel: "100000", fdr: "50000", extras: "10000", total: "160000" },
    approved: { fuel: "200000", fdr: "80000", extras: "0", total: "280000" },
    disbursed: { fuel: "60000", fdr: "30000", extras: "0", total: "90000" },
  } as const;
  for (const status of ["requested", "approved", "disbursed"] as const) {
    const orderNumber = token(`MIS-${status}`);
    const [mission] = await db
      .insert(missions)
      .values({ clientId: client.id, orderNumber, status: "planned", pickupAddress: "Douala, port", deliveryAddress: "Yaoundé, entrepôt", createdBy: accounts.logistics.id })
      .returning({ id: missions.id });
    missionOf[status] = { id: mission.id, orderNumber };
    const b = budgets[status];
    await db.insert(missionBudgets).values({
      missionId: mission.id,
      budgetDate: DATE,
      fuelLiters: String(Number(b.fuel) / 840),
      fuelUnitPrice: "840",
      fuelAmount: b.fuel,
      fdrAmount: b.fdr,
      extrasAmount: b.extras,
      totalAmount: b.total,
      status,
      createdBy: accounts.logistics.id,
      updatedBy: accounts.logistics.id,
    });
  }
});

test.afterAll(async () => {
  await purge();
  await cleanupCreated(ids);
});

test.describe("L1f-2 : besoin du jour des budgets de mission", () => {
  test.setTimeout(240_000);

  test("totaux, reste à décaisser, détail par mission ; l'approbation par la direction atteint le secrétariat", async ({ browser }) => {
    const secretary = await open(browser, accounts.secretary);
    const management = await open(browser, accounts.management);
    try {
      await openDailyNeed(secretary.page);
      await expect(sidebar(secretary.page).getByText("Besoin du jour")).toBeVisible();
      await expect(secretary.page.getByTestId("daily-need-total")).toContainText(amount("530 000"));
      await expect(secretary.page.getByTestId("daily-need-to-disburse")).toContainText(amount("440 000"));
      await expect(secretary.page.getByTestId("daily-need-status-approved")).toContainText(amount("280 000"));
      for (const { orderNumber } of Object.values(missionOf)) await expect(secretary.page.getByText(orderNumber)).toBeVisible();
      await capture(secretary.page, "1-secretariat-besoin-du-jour");

      // Direction : approuve le budget demandé depuis la fiche mission.
      await management.page.goto(`/missions/${missionOf.requested.id}`, { waitUntil: "domcontentloaded" });
      await management.page.getByRole("tab", { name: "Budget" }).click();
      await management.page.getByTestId("button-mission-budget-approve").click();
      await expect(management.page.getByTestId("mission-budget-status")).toHaveText("Approuvé");

      // Secrétariat : la trame arrive, puis l'écran suit sans rechargement.
      await expect
        .poll(
          () =>
            secretary.frames.some(
              (f) => f.includes("mission_budget_updated") && f.includes(`"missionId":${missionOf.requested.id}`) && f.includes('"status":"approved"'),
            ),
          { timeout: 15_000 },
        )
        .toBe(true);
      await expect(secretary.page.getByTestId("daily-need-status-approved")).toContainText(amount("440 000"), { timeout: 15_000 });
      await expect(secretary.page.getByTestId("daily-need-status-requested")).toHaveText(/^Demandé\s*0\s*0\sFCFA$/);
      await expect(secretary.page.getByTestId("daily-need-to-disburse"), "approuver ne décaisse rien").toContainText(amount("440 000"));
      await capture(secretary.page, "2-secretariat-apres-approbation");

      // Direction : même page, même lecture.
      await openDailyNeed(management.page);
      await capture(management.page, "3-direction-besoin-du-jour");

      // La ligne mène à la fiche mission.
      await secretary.page.getByText(missionOf.disbursed.orderNumber).click();
      await expect(secretary.page).toHaveURL(new RegExp(`/missions/${missionOf.disbursed.id}$`));
    } finally {
      await secretary.context.close();
      await management.context.close();
    }

    const logistics = await open(browser, accounts.logistics);
    try {
      await openDailyNeed(logistics.page);
      await capture(logistics.page, "4-logistique-besoin-du-jour");
    } finally {
      await logistics.context.close();
    }
  });

  test("technicien : ni page ni entrée de menu", async ({ browser }) => {
    const technician = await open(browser, accounts.technician);
    try {
      await technician.page.goto("/finance/mission-budgets", { waitUntil: "domcontentloaded" });
      await expect(sidebar(technician.page)).toBeVisible({ timeout: 60_000 });
      await expect(technician.page.getByTestId("mission-budgets-daily-need")).toHaveCount(0);
      await expect(sidebar(technician.page).getByText("Besoin du jour")).toHaveCount(0);
      await capture(technician.page, "5-technicien-sans-acces");
    } finally {
      await technician.context.close();
    }
  });
});
