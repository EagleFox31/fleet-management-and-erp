import { expect, test, type Page } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "../server/db";
import { assignments, clientInvoices, drivers, missionPodFiles, missions } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestClient, createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../tests/support/factories";
import { deleteClientInvoicesWhere } from "../tests/support/money-override";
import { cleanupPodFiles, tinyPdf } from "../tests/support/pod";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { newE2EContext } from "./helpers/contexts";
import { createE2EUser } from "./helpers/test-data";

/**
 * POD (preuve de livraison), niveau E, deux comptes de rôles différents (AGENTS.md §3) :
 * le chauffeur dépose le POD depuis son espace mobile (`/`), la logistique, qui regarde la fiche
 * de la mission, reçoit la trame WebSocket `mission_pod_uploaded` et voit le fichier sans recharger.
 * La mission est ensuite livrée : le bouton de facture, fermé tant qu'aucun POD n'existait, s'ouvre
 * et la facture est créée.
 *
 * Les listes de POD n'ont pas de `refetchInterval` : la trame est vérifiée elle-même, pas seulement l'écran.
 * Données préfixées E2E-POD-, supprimées en fin de spec (et à l'ouverture si un run a planté).
 */

const PREFIX = "E2E-POD-";
const HT = 250000;
const ids = createIdBag();
let stamp = 0;
const token = (label: string) => `${PREFIX}${label}-${Date.now().toString(36)}-${++stamp}`;

let driverUser: E2ECredentials & { id: number };
let logistics: E2ECredentials;
let missionId = 0;
let orderNumber = "";

async function purge(): Promise<void> {
  const rows = await db.select({ id: missions.id }).from(missions).where(like(missions.orderNumber, `${PREFIX}%`));
  const missionIds = rows.map((row) => row.id);
  if (missionIds.length > 0) {
    await deleteClientInvoicesWhere(inArray(clientInvoices.missionId, missionIds));
    await cleanupPodFiles(missionIds);
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  await db.delete(drivers).where(like(drivers.lastName, `${PREFIX}%`));
}

test.beforeAll(async () => {
  await purge();
  logistics = await createE2EUser("logistics", ids);
  const name = token("DRV");
  const user = await createTestUser({ role: "driver", username: name, name, email: `${name.toLowerCase()}@fleet.test` });
  ids.userIds.push(user.id);
  driverUser = { id: user.id, username: user.username, password: TEST_USER_PASSWORD, label: "chauffeur" };

  const client = await createTestClient({ name: token("CLIENT") });
  ids.clientIds.push(client.id);
  const [driver] = await db
    .insert(drivers)
    .values({ userId: user.id, firstName: "Chauffeur", lastName: token("D"), employeeNumber: token("EMP"), isActive: true })
    .returning();
  const vehicle = await createTestVehicle({ registrationNumber: `${PREFIX}V${Date.now().toString(36)}`.slice(0, 32) });
  ids.vehicleIds.push(vehicle.id);
  orderNumber = token("MIS");
  const [mission] = await db
    .insert(missions)
    .values({ clientId: client.id, orderNumber, status: "in_progress", pickupAddress: "Douala, port", deliveryAddress: "Yaoundé, entrepôt" })
    .returning();
  missionId = mission.id;
  await db.insert(assignments).values({ missionId, vehicleId: vehicle.id, driverId: driver.id, status: "in_progress", startedAt: new Date() });
});

test.afterAll(async () => {
  await purge();
  await cleanupCreated(ids);
});

/** Trames reçues sur la socket `/ws` de la page, à brancher avant toute navigation. */
function captureFrames(page: Page): string[] {
  const frames: string[] = [];
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/ws")) return;
    socket.on("framereceived", (frame) => frames.push(typeof frame.payload === "string" ? frame.payload : frame.payload.toString()));
  });
  return frames;
}

test.describe("POD : dépôt par le chauffeur, vu par la logistique, puis facture", () => {
  test("le chauffeur dépose le POD, la logistique le voit sans recharger, la facture s'ouvre", async ({ browser }) => {
    test.setTimeout(240_000);
    const logisticsContext = await newE2EContext(browser, "logistique");
    const driverContext = await newE2EContext(browser, "chauffeur");
    try {
      const logisticsPage = await logisticsContext.newPage();
      const frames = captureFrames(logisticsPage);
      await loginWithSession(logisticsPage, logistics);
      await logisticsPage.goto(`/missions/${missionId}`, { waitUntil: "domcontentloaded" });
      await expect(logisticsPage.getByRole("heading", { name: orderNumber })).toBeVisible({ timeout: 60_000 });
      await expect(logisticsPage.getByTestId("pod-empty")).toBeVisible({ timeout: 30_000 });
      await expect(logisticsPage.getByTestId("button-open-generate-invoice-dialog")).toBeDisabled();
      await expect
        .poll(() => frames.some((f) => f.includes("auth_success")), { message: "socket /ws de la logistique non ouverte", timeout: 60_000 })
        .toBe(true);

      // Le chauffeur dépose le POD depuis son espace mobile (appareil photo arrière sur téléphone).
      const driverPage = await driverContext.newPage();
      await loginWithSession(driverPage, driverUser);
      await driverPage.goto("/", { waitUntil: "domcontentloaded" });
      await expect(driverPage.getByText(`#${orderNumber}`)).toBeVisible({ timeout: 60_000 });
      await expect(driverPage.getByTestId("driver-button-pod-deposit-input")).toHaveAttribute("capture", "environment");
      const deposit = driverPage.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/api/missions/${missionId}/pod-files`));
      await driverPage.getByTestId("driver-button-pod-deposit-input").setInputFiles({
        name: "bon-de-livraison.pdf",
        mimeType: "application/pdf",
        buffer: tinyPdf(token("pdf")),
      });
      expect((await deposit).status()).toBe(201);
      const stored = await db.select().from(missionPodFiles).where(eq(missionPodFiles.missionId, missionId));
      expect(stored).toHaveLength(1);

      // Temps réel : la trame atteint la logistique (pas de polling sur cette liste), puis l'écran suit sans rechargement.
      const frameOfMission = new RegExp(String.raw`"missionId"\s*:\s*${missionId}(?!\d)`);
      await expect
        .poll(() => frames.filter((f) => f.includes("mission_pod_uploaded") && frameOfMission.test(f)).length, {
          message: "trame mission_pod_uploaded absente côté logistique",
          timeout: 15_000,
        })
        .toBeGreaterThanOrEqual(1);
      await expect(logisticsPage.getByTestId("pod-list")).toContainText("bon-de-livraison.pdf", { timeout: 5_000 });

      // Livraison par la logistique : le POD existe, la facture s'ouvre.
      const delivered = await logisticsPage.request.put(`/api/missions/${missionId}/status`, { data: { status: "delivered" } });
      expect(delivered.status(), await delivered.text()).toBeLessThan(300);
      await expect(logisticsPage.getByTestId("button-open-generate-invoice-dialog")).toBeEnabled({ timeout: 30_000 });
      await expect(logisticsPage.getByTestId("invoice-gate-reason")).toHaveCount(0);

      // Ouverture du fichier : réponse 200, jamais de cache, bac à sable.
      const file = await logisticsPage.request.get(`/api/missions/${missionId}/pod-files/${stored[0].id}`);
      expect(file.status()).toBe(200);
      expect(file.headers()["cache-control"]).toContain("no-store");
      expect(file.headers()["content-security-policy"]).toContain("sandbox");

      await logisticsPage.getByTestId("button-open-generate-invoice-dialog").click();
      await logisticsPage.getByTestId("input-amount").fill(String(HT));
      await logisticsPage.getByTestId("input-due-date").fill("2099-12-31");
      await logisticsPage.getByTestId("button-submit-invoice").click();
      await expect(logisticsPage).toHaveURL(/\/operations\/invoices\/\d+$/, { timeout: 30_000 });
      const invoices = await db.select().from(clientInvoices).where(eq(clientInvoices.missionId, missionId));
      expect(invoices, "facture créée après le dépôt du POD").toHaveLength(1);
    } finally {
      await driverContext.close();
      await logisticsContext.close();
    }
  });
});
