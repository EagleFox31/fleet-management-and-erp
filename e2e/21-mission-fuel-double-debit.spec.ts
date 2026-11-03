import { expect, test, type Page } from "@playwright/test";
import { and, eq, gt, inArray, like } from "drizzle-orm";
import { db } from "../server/db";
import { assignments, clients, drivers, fuelRecords, missions, users, vehicles } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestClient, createTestFuelRecord, createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../tests/support/factories";
import { fuelCardService } from "../server/services/fuel-card-service";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";

/**
 * FUEL-DBL, niveau E : un plein de mission dont la réponse est perdue ne débite la carte qu'une fois.
 *
 * Scénario (#181) : le chauffeur valide un plein, le serveur l'écrit, la réponse ne revient pas
 * (réseau coupé). Il ferme la fiche, la rouvre et renvoie le même plein. La clé de soumission,
 * conservée en sessionStorage parce que l'issue est inconnue, fait rejouer le serveur : un seul
 * débit en base.
 *
 * La coupure est jouée par `page.route` : la requête part au serveur (`route.fetch`), puis la
 * réponse est jetée (`route.abort`). Service worker bloqué, sinon `page.route` ne voit rien.
 *
 * Données préfixées E2E-FDBL-, supprimées en fin de spec (et à l'ouverture si un run a planté).
 */

const PREFIX = "E2E-FDBL-";
const ids = createIdBag();
let stamp = 0;
const token = (label: string) => `${PREFIX}${label}-${Date.now().toString(36)}-${++stamp}`;

let driverUser: E2ECredentials & { id: number };
let missionId: number;
let vehicleId: number;
let orderNumber: string;

test.use({ serviceWorkers: "block" });

async function purge(): Promise<void> {
  const missionRows = await db.select({ id: missions.id }).from(missions).where(like(missions.orderNumber, `${PREFIX}%`));
  const missionIds = missionRows.map((row) => row.id);
  const vehicleRows = await db.select({ id: vehicles.id }).from(vehicles).where(like(vehicles.registrationNumber, `${PREFIX}%`));
  const vehicleIds = vehicleRows.map((row) => row.id);
  if (vehicleIds.length > 0) await db.delete(fuelRecords).where(inArray(fuelRecords.vehicleId, vehicleIds));
  if (missionIds.length > 0) {
    await db.delete(fuelRecords).where(inArray(fuelRecords.missionId, missionIds));
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  await db.delete(drivers).where(like(drivers.lastName, `${PREFIX}%`));
  const bag = createIdBag();
  bag.vehicleIds.push(...vehicleIds);
  bag.clientIds.push(...(await db.select({ id: clients.id }).from(clients).where(like(clients.name, `${PREFIX}%`))).map((r) => r.id));
  bag.userIds.push(...(await db.select({ id: users.id }).from(users).where(like(users.username, `${PREFIX}%`))).map((r) => r.id));
  await cleanupCreated(bag);
}

/** Débits écrits sur la carte pour cette mission (les crédits de mise en place sont exclus). */
async function missionDebits() {
  return db
    .select({ id: fuelRecords.id, debitAmount: fuelRecords.debitAmount })
    .from(fuelRecords)
    .where(and(eq(fuelRecords.missionId, missionId), gt(fuelRecords.debitAmount, "0")));
}

async function openFuelSheet(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Enregistrer un plein" }).click();
  await expect(page.getByRole("heading", { name: "Enregistrer un plein" })).toBeVisible();
  const sheet = page.locator("label").filter({ hasText: "Litres" }).locator("input");
  await sheet.fill("3");
  // Prix imposé (drapeau `fuel-prices`) : champ en lecture seule ; sinon saisie libre.
  const price = page.locator("label").filter({ hasText: "Prix / L" }).locator("input");
  if (!(await price.getAttribute("readonly").then((v) => v !== null))) await price.fill("800");
  await page.getByPlaceholder("Commentaire libre si besoin").fill(`${PREFIX}plein`);
}

test.beforeAll(async () => {
  await purge();
  const client = await createTestClient({ name: token("CLIENT") });
  ids.clientIds.push(client.id);
  const name = token("CHAUFFEUR");
  const user = await createTestUser({ role: "driver", username: name, name, email: `${name.toLowerCase()}@fleet.test` });
  ids.userIds.push(user.id);
  driverUser = { id: user.id, username: user.username, password: TEST_USER_PASSWORD, label: "CHAUFFEUR" };
  const [driver] = await db
    .insert(drivers)
    .values({ userId: user.id, firstName: "Chauffeur", lastName: token("DRV"), employeeNumber: token("EMP"), isActive: true })
    .returning();
  const vehicle = await createTestVehicle({ registrationNumber: `${PREFIX}${Date.now().toString(36)}`.slice(0, 32) });
  ids.vehicleIds.push(vehicle.id);
  vehicleId = vehicle.id;
  orderNumber = token("MIS");
  const [mission] = await db
    .insert(missions)
    .values({ clientId: client.id, orderNumber, status: "assigned", pickupAddress: "Douala, port", deliveryAddress: "Yaoundé, entrepôt" })
    .returning();
  missionId = mission.id;
  await db.insert(assignments).values({ missionId, vehicleId, driverId: driver.id, status: "accepted" });
  // Solde suffisant quel que soit l'état de la base : crédit sur le véhicule de test, purgé avec lui.
  const { balance } = await fuelCardService.getCurrentBalance();
  await createTestFuelRecord({ vehicleId, creditAmount: (Math.max(0, -balance) + 100_000).toFixed(2), debitAmount: "0", cost: "0", quantity: 0 });
});

test.afterAll(async () => {
  await purge();
  await cleanupCreated(ids);
});

test.describe("FUEL-DBL : plein de mission sans réponse", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithSession(page, driverUser);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(`#${orderNumber}`)).toBeVisible({ timeout: 60_000 });
  });

  test("réponse perdue, fiche fermée puis rouverte, nouvel envoi : un seul débit", async ({ page }) => {
    const path = `/api/missions/${missionId}/fuel-records`;
    const sentKeys: string[] = [];
    let cut = true;
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      sentKeys.push(String(route.request().postDataJSON()?.requestKey ?? ""));
      if (!cut) return route.continue();
      cut = false;
      // Le serveur écrit le plein ; le navigateur ne reçoit jamais la réponse.
      const served = await route.fetch();
      expect(served.status(), "premier envoi accepté par le serveur").toBeLessThan(300);
      await route.abort("failed");
    });

    await openFuelSheet(page);
    await page.getByRole("button", { name: "Valider le plein" }).click();
    await expect.poll(async () => (await missionDebits()).length, { message: "premier plein écrit en base" }).toBe(1);
    await expect(page.getByText("Erreur carburant").first()).toBeVisible();

    await page.getByRole("button", { name: "Annuler" }).click();
    await expect(page.getByRole("heading", { name: "Enregistrer un plein" })).toHaveCount(0);

    await openFuelSheet(page);
    const [replay] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(path)),
      page.getByRole("button", { name: "Valider le plein" }).click(),
    ]);
    expect(replay.status(), "renvoi rejoué par le serveur").toBeLessThan(300);

    expect(sentKeys, "deux envois, même clé de soumission").toHaveLength(2);
    expect(sentKeys[0]).not.toBe("");
    expect(sentKeys[1]).toBe(sentKeys[0]);
    expect(await missionDebits(), "un seul débit sur la carte").toHaveLength(1);
  });
});
