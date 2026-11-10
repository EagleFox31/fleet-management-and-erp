import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { assignments, clientInvoices, missions, vehicles } from "../../shared/schema";
import { tinyPdf } from "../../tests/support/pod";
import { beat, loginThroughForm, mark } from "./helpers";
import { assertLocalDatabase, DEMO_ACCOUNTS, DEMO_MISSION, seedDemo } from "./seed-demo";

/**
 * Démo « logistique » : créer une mission pour un donneur d'ordre, l'affecter (camion,
 * remorque et chauffeur), la lancer avec ses budgets, la livrer, la clôturer, puis générer
 * la facture client. Le règlement de la facture revient au secrétariat (spec suivante).
 *
 * `mark(...)` pose des repères de montage (voix off) quand DEMO_MARKS_FILE est défini.
 */
const ORDER = `${DEMO_MISSION.orderPrefix}001`;

async function missionStatus(): Promise<string | undefined> {
  const [row] = await db.select({ status: missions.status }).from(missions).where(eq(missions.orderNumber, ORDER));
  return row?.status;
}

async function missionTrailer(): Promise<{ trailerId: number | null; registration: string | null } | undefined> {
  const [row] = await db
    .select({ trailerId: assignments.trailerId, registration: vehicles.registrationNumber })
    .from(assignments)
    .innerJoin(missions, eq(missions.id, assignments.missionId))
    .leftJoin(vehicles, eq(vehicles.id, assignments.trailerId))
    .where(eq(missions.orderNumber, ORDER));
  return row;
}

test.beforeAll(async () => {
  assertLocalDatabase();
  await seedDemo();
});

test("démo logistique : de la création de la mission à la facture client", async ({ page }) => {
  test.setTimeout(300_000);
  mark("start");
  await loginThroughForm(page, DEMO_ACCOUNTS.logistics.username, DEMO_ACCOUNTS.logistics.password);
  mark("login-done");
  // Tableau de bord laissé lisible : la voix décrit le solde carburant puis les compteurs de missions.
  await beat(page, 17_000);
  mark("dashboard-done");

  // Création : assistant en quatre étapes.
  await page.getByRole("link", { name: "Missions transport" }).first().click();
  await expect(page.getByTestId("btn-new-mission")).toBeVisible({ timeout: 30_000 });
  await beat(page, 1200);
  await page.getByTestId("btn-new-mission").click();
  mark("wizard-open");
  await beat(page, 1500);
  mark("wizard-form");

  await page.getByTestId("select-client").click();
  await page.getByRole("option", { name: DEMO_MISSION.clientName }).click();
  await page.getByTestId("input-order-number").fill(ORDER);
  await beat(page);
  mark("client-done");
  await page.getByTestId("btn-next").click();

  await page.getByTestId("input-pickup-address").fill("Douala, port autonome");
  await page.getByTestId("input-delivery-address").fill("Yaoundé, entrepôt central");
  await page.getByTestId("textarea-cargo").fill("Palettes de boissons, 18 tonnes");
  await beat(page);
  mark("route-done");
  await page.getByTestId("btn-next").click();

  // Affectation : le camion, la remorque attelée au camion, puis le chauffeur.
  await page.getByTestId("select-vehicle").click();
  await page.getByRole("option", { name: new RegExp(DEMO_MISSION.vehicle) }).click();
  await beat(page, 1200);
  mark("truck-done");
  await page.getByTestId("select-trailer").click();
  await page.getByRole("option", { name: new RegExp(DEMO_MISSION.trailer) }).click();
  await expect(page.getByTestId("select-trailer")).toContainText(DEMO_MISSION.trailer);
  await beat(page, 2500);
  mark("trailer-done");
  await page.getByTestId("select-driver").click();
  await page.getByRole("option", { name: new RegExp(DEMO_MISSION.driverEmployee) }).click();
  await beat(page, 1200);
  mark("driver-done");
  await page.getByTestId("btn-next").click();
  await beat(page, 3000);
  mark("summary-done");
  await page.getByTestId("btn-submit").click();
  mark("submitted");

  await expect.poll(missionStatus, { timeout: 30_000 }).toBeTruthy();
  // Assertion dure : l'affectation de la mission porte bien la remorque choisie.
  const [trailerVehicle] = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.registrationNumber, DEMO_MISSION.trailer));
  const hitched = await missionTrailer();
  expect(hitched?.trailerId).toBe(trailerVehicle.id);
  expect(hitched?.registration).toBe(DEMO_MISSION.trailer);
  await expect(page.getByTestId("table-missions")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("input-search-missions").fill(ORDER);
  await beat(page, 1000);
  await page.getByText(ORDER, { exact: true }).first().click();
  await expect(page.getByRole("heading", { name: ORDER })).toBeVisible({ timeout: 30_000 });
  await beat(page, 1500);
  mark("created-shown");
  // La fiche de la mission montre la remorque attelée, à côté du camion et du chauffeur.
  const trailerCard = page.getByTestId("mission-trailer");
  // Centre la carte dans la fenêtre : elle est sous la ligne de flottaison à l'arrivée sur la fiche.
  await trailerCard.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect(trailerCard).toContainText(DEMO_MISSION.trailer, { timeout: 30_000 });
  await beat(page, 4000);
  mark("trailer-shown");

  // Lancement : budgets demandés, puis la mission part.
  expect(["planned", "assigned"]).toContain(await missionStatus());
  await page.getByTestId("button-transition-mission-status-header").click();
  await expect(page.getByTestId("button-save-mission-budgets")).toBeVisible({ timeout: 15_000 });
  for (const [field, value] of [["fuelBudget", "1000"], ["roadExpensesBudget", "5000"], ["contingencyBudget", "2000"]] as const) {
    const input = page.getByTestId(`input-mission-budget-${field}`);
    await expect(input).toBeVisible();
    await input.fill(value);
    await beat(page, 400);
  }
  await page.getByTestId("button-save-mission-budgets").click();
  await expect.poll(missionStatus, { timeout: 30_000 }).toBe("in_progress");
  await beat(page, 1500);

  // Livraison.
  await page.getByTestId("button-transition-mission-status-header").click();
  await expect.poll(missionStatus, { timeout: 30_000 }).toBe("delivered");
  await beat(page, 1500);

  // Preuve de livraison : sans elle, la facture reste fermée.
  await page.getByTestId("button-pod-deposit-header-input").setInputFiles({
    name: "bon-de-livraison.pdf",
    mimeType: "application/pdf",
    buffer: tinyPdf("demo-logistique"),
  });
  await expect(page.getByTestId("pod-list")).toContainText("bon-de-livraison.pdf", { timeout: 30_000 });
  await beat(page, 1500);

  // Clôture : aucun plein rattaché (motif), frais de route réels.
  await page.getByTestId("button-transition-mission-status-header").click();
  await page.getByTestId("textarea-mission-no-fuel-reason").fill("Mission courte, aucun ravitaillement.");
  await beat(page, 600);
  await page.getByTestId("button-declare-no-fuel-and-close").click();
  await page.getByTestId("input-mission-close-fdr").fill("0");
  await beat(page, 600);
  await page.getByTestId("button-confirm-mission-close-fdr").click();
  await expect.poll(missionStatus, { timeout: 30_000 }).toBe("completed");
  await beat(page, 1500);

  // Facture client depuis la mission clôturée.
  await page.getByTestId("button-open-generate-invoice-dialog").click();
  await page.getByTestId("input-amount").fill("250000");
  await page.getByTestId("input-due-date").fill(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  await beat(page, 800);
  await page.getByTestId("button-submit-invoice").click();
  await expect(page).toHaveURL(/\/operations\/invoices\/\d+$/, { timeout: 30_000 });
  const [mission] = await db.select({ id: missions.id }).from(missions).where(eq(missions.orderNumber, ORDER));
  const invoices = await db.select().from(clientInvoices).where(eq(clientInvoices.missionId, mission.id));
  expect(invoices).toHaveLength(1);
  await beat(page, 3000);
});
