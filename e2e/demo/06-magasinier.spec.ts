import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { partRequirements, parts, purchaseOrders, workOrders } from "../../shared/schema";
import { beat, loginThroughForm } from "./helpers";
import { assertLocalDatabase, DEMO_ACCOUNTS, DEMO_PART, DEMO_RECEPTION } from "./seed-demo";

/**
 * Démo « magasinier » : réceptionner la commande fournisseur (entrée en stock), puis sortir la pièce
 * pour l'ordre de travail de l'atelier qui l'attend.
 */
async function stock(): Promise<number> {
  const [row] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.reference, DEMO_PART.reference));
  return row.quantity;
}

test.beforeAll(() => assertLocalDatabase());

test("démo magasinier : réception d'une commande, entrée en stock, sortie vers l'atelier", async ({ page }) => {
  test.setTimeout(150_000);
  const stockBefore = await stock();
  await loginThroughForm(page, DEMO_ACCOUNTS.warehouse.username, DEMO_ACCOUNTS.warehouse.password);

  // Réception de la commande.
  await page.getByRole("link", { name: "Commandes", exact: true }).first().click();
  await expect(page.getByText(DEMO_RECEPTION.orderNumber).first()).toBeVisible({ timeout: 30_000 });
  await beat(page, 1200);
  await page.getByRole("row").filter({ hasText: DEMO_RECEPTION.orderNumber }).locator('[data-testid^="button-view-"]').click();
  await page.getByTestId("button-status-delivered").click();
  await page.getByTestId("input-delivery-code").fill(DEMO_RECEPTION.deliveryCode);
  await beat(page);
  await page.getByTestId("button-confirm-delivery").click();
  await expect.poll(async () => (await db.select({ s: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.orderNumber, DEMO_RECEPTION.orderNumber)))[0]?.s, { timeout: 20_000 }).toBe("delivered");
  await beat(page, 1500);
  await expect.poll(stock, { timeout: 20_000 }).toBe(stockBefore + DEMO_RECEPTION.orderedQuantity);

  // Sortie de la pièce vers l'atelier.
  const [wo] = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.title, DEMO_RECEPTION.workOrderTitle));
  await page.getByRole("link", { name: "Demandes de pièces" }).first().click();
  await beat(page, 1500);
  const viewWo = page.getByTestId(`btn-view-wo-${wo.id}`);
  if (await viewWo.isVisible().catch(() => false)) await viewWo.click();
  else await page.goto(`/maintenance/work-orders/${wo.id}`);
  await page.getByRole("tab", { name: /Pièces/ }).click();
  await expect(page.getByText("Sortir du stock").first()).toBeVisible({ timeout: 30_000 });
  await beat(page, 1200);
  await page.getByRole("button", { name: "Sortir du stock" }).first().click();
  await expect(page.getByText("Pièce sortie du stock").first()).toBeVisible({ timeout: 20_000 });
  await beat(page, 2000);

  const [req] = await db.select({ status: partRequirements.status }).from(partRequirements).where(eq(partRequirements.workOrderId, wo.id));
  expect(req.status).toBe("issued");
  expect(await stock()).toBe(stockBefore + DEMO_RECEPTION.orderedQuantity - DEMO_RECEPTION.requestedQuantity);
});
