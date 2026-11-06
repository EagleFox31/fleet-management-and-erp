import { expect, test, type Page } from "@playwright/test";
import { inArray } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { db } from "../server/db";
import { partsUsed, tireRotations, workOrderItems, workOrders, workshopLaborRates } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestPart, createTestVehicle } from "../tests/support/factories";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";

/**
 * WO5 niveau navigateur : le coût d'un ordre de travail est le même sur l'écran de l'OT, dans son
 * PDF et dans le KPI de coûts, et il est égal au montant calculé ici à la main.
 *
 * Montants écrits en dur (pas de réutilisation de `computeWorkOrderCost`) :
 * - taux daté : 3,75 h (2,5 + 1,25 ; la ligne annulée de 10 h est exclue) x 8 000 = 30 000,
 *   le coût saisi de 9 999 est ignoré ; pièces 2 x 1 500 = 3 000 ; pneu 2 000 -> 35 000.
 * - sans taux : coût saisi 700 ; pièces 2 x 50 = 100 ; pneu 40 -> 840.
 *
 * Dates propres à cette spec (la date d'effet d'un taux est unique, base partagée) : le taux prend
 * effet le 2016-09-01, l'OT valorisé est clos le 2016-09-20, l'OT sans taux le 2016-03-10.
 */

const ids = createIdBag();
const woIds: number[] = [];
const rateIds: number[] = [];
let admin: E2ECredentials & { id: number };

test.beforeAll(async () => {
  admin = await createE2EUser("admin", ids);
});

test.afterAll(async () => {
  if (woIds.length) {
    await db.delete(workOrderItems).where(inArray(workOrderItems.workOrderId, woIds));
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, woIds));
    await db.delete(tireRotations).where(inArray(tireRotations.workOrderId, woIds));
    await db.delete(workOrders).where(inArray(workOrders.id, woIds));
  }
  if (rateIds.length) await db.delete(workshopLaborRates).where(inArray(workshopLaborRates.id, rateIds));
  await cleanupCreated(ids);
});

/** Montant d'un libellé monétaire (`35 000 FCFA`, espaces insécables compris) en entier. */
function amountOf(text: string): number {
  const digits = text.replace(/[^\d]/g, "");
  expect(digits, `montant illisible : « ${text} »`).not.toBe("");
  return Number(digits);
}

/** Chaînes de texte d'un PDF jsPDF : flux décompressés au besoin, opérandes de `Tj`. */
function pdfTexts(buffer: Buffer): string[] {
  const raw = buffer.toString("latin1");
  const streams: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const body = Buffer.from(match[1], "latin1");
    try {
      streams.push(inflateSync(body).toString("latin1"));
    } catch {
      streams.push(match[1]);
    }
  }
  const texts: string[] = [];
  for (const stream of streams) {
    for (const m of stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) texts.push(m[1].replace(/\\(.)/g, "$1"));
  }
  return texts;
}

async function seedWorkOrder(opts: {
  title: string;
  cost: string;
  endDate: string;
  hours: string[];
  partQty: number;
  partPrice: string;
  tireCost: string;
}): Promise<{ id: number; vehicleId: number }> {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const part = await createTestPart();
  ids.partIds.push(part.id);
  const [wo] = await db
    .insert(workOrders)
    .values({
      vehicleId: vehicle.id,
      technicianId: admin.id,
      title: opts.title,
      status: "completed",
      cost: opts.cost,
      startDate: new Date(`${opts.endDate}T08:00:00Z`),
      endDate: new Date(`${opts.endDate}T16:00:00Z`),
    })
    .returning();
  woIds.push(wo.id);
  await db.insert(workOrderItems).values([
    ...opts.hours.map((h, i) => ({ workOrderId: wo.id, customLabel: `TEST travail ${i}`, actualHours: h, status: "done" as const })),
    { workOrderId: wo.id, customLabel: "TEST annulé", actualHours: "10", status: "cancelled" },
  ]);
  await db.insert(partsUsed).values({ workOrderId: wo.id, partId: part.id, quantity: opts.partQty, unitPrice: opts.partPrice });
  await db.insert(tireRotations).values({
    vehicleId: vehicle.id,
    workOrderId: wo.id,
    rotationDate: opts.endDate,
    rotationMileage: 5000,
    rotationType: "front_to_back",
    cost: opts.tireCost,
  });
  return { id: wo.id, vehicleId: vehicle.id };
}

/** Coût lu sur l'écran (en-tête et récapitulatif), dans le PDF téléchargé, et par l'API KPI. */
async function readThreeCosts(page: Page, wo: { id: number; vehicleId: number }, day: string, expectedTotal: number) {
  await page.goto(`/maintenance/work-orders/${wo.id}?tab=report`, { waitUntil: "domcontentloaded" });
  const header = page.getByText("Coût total", { exact: true }).locator("xpath=following-sibling::div");
  await expect(header).toBeVisible({ timeout: 60_000 });
  const recapTotal = page.getByText("Total", { exact: true }).locator("xpath=following-sibling::span").first();
  await expect(recapTotal).toBeVisible();

  // Le total affiché dépend du taux, chargé après l'OT : on attend le montant attendu (un total partiel > 0 ne suffit pas).
  const printButton = page.getByTestId("button-print-work-order");
  await expect(printButton).toBeEnabled({ timeout: 30_000 });
  await expect.poll(async () => amountOf((await header.textContent()) ?? ""), { timeout: 30_000 }).toBe(expectedTotal);
  const screenHeader = amountOf((await header.textContent()) ?? "");
  const screenRecap = amountOf((await recapTotal.textContent()) ?? "");

  const [download] = await Promise.all([page.waitForEvent("download"), printButton.click()]);
  const path = await download.path();
  const texts = pdfTexts(readFileSync(path));
  const totalIndex = texts.findIndex((t) => t.trim() === "TOTAL");
  expect(totalIndex, `ligne TOTAL absente du PDF (${texts.length} textes)`).toBeGreaterThanOrEqual(0);
  const pdfTotal = amountOf(texts[totalIndex + 1] ?? "");

  const kpi = await page.request.get(`/api/kpi/maintenance-costs?from=${day}&to=${day}&groupBy=vehicle`);
  expect(kpi.status()).toBe(200);
  const body = (await kpi.json()) as { groups: Array<{ key: string; interventions: number; totalCost: number }> };
  const group = body.groups.find((g) => g.key === String(wo.vehicleId));
  expect(group, "véhicule absent du KPI").toBeTruthy();
  expect(group!.interventions).toBe(1);
  return { screenHeader, screenRecap, pdfTotal, kpiTotal: group!.totalCost };
}

test.describe("WO5 - coût d'un ordre de travail (navigateur)", () => {
  test("taux horaire daté : écran = PDF = KPI = 35 000", async ({ page }) => {
    test.setTimeout(240_000);
    const [rate] = await db.insert(workshopLaborRates).values({ effectiveFrom: "2016-09-01", hourlyRateHt: "8000" }).returning();
    rateIds.push(rate.id);
    const wo = await seedWorkOrder({
      title: "TEST-wo5-e2e-taux",
      cost: "9999",
      endDate: "2016-09-20",
      hours: ["2.5", "1.25"],
      partQty: 2,
      partPrice: "1500",
      tireCost: "2000",
    });

    await loginWithSession(page, admin);
    const costs = await readThreeCosts(page, wo, "2016-09-20", 35000);
    expect(costs).toEqual({ screenHeader: 35000, screenRecap: 35000, pdfTotal: 35000, kpiTotal: 35000 });
  });

  test("aucun taux en vigueur : le coût saisi vaut main-d'oeuvre, écran = PDF = KPI = 840", async ({ page }) => {
    test.setTimeout(240_000);
    const wo = await seedWorkOrder({
      title: "TEST-wo5-e2e-sans-taux",
      cost: "700",
      endDate: "2016-03-10",
      hours: ["4"],
      partQty: 2,
      partPrice: "50",
      tireCost: "40",
    });

    await loginWithSession(page, admin);
    // Le cas suppose qu'aucun taux n'est en vigueur au 2016-03-10 (le contrat work-order-labor-rate en pose un au
    // 2016-03-01 le temps de son passage) : on l'affirme au lieu de le supposer.
    const rateRes = await page.request.get(`/api/work-orders/${wo.id}/labor-rate`);
    expect(rateRes.status()).toBe(200);
    expect(await rateRes.json(), "aucun taux en vigueur à la clôture de l'OT").toBeNull();
    const costs = await readThreeCosts(page, wo, "2016-03-10", 840);
    expect(costs).toEqual({ screenHeader: 840, screenRecap: 840, pdfTotal: 840, kpiTotal: 840 });
  });
});
