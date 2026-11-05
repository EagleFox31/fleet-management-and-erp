import { expect, test, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { assignments, clientInvoices, drivers, missions, vehicleDocuments } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestClient } from "../tests/support/factories";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";
import {
  createLaunchableDriver,
  createLaunchableVehicle,
  creditFuelCard,
  FAR,
  purgeJourneyRows,
} from "./helpers/mission-journey";
import { newE2EContext } from "./helpers/contexts";

/**
 * MIS1, niveau E : le cycle de vie d'une mission rejoué au navigateur, sans écrire
 * l'état « livrée » en base.
 *
 *   création (API logistique) -> affectation véhicule + chauffeur (écran) -> lancement
 *   (budgets, gardes métier) -> livraison -> clôture (carburant, FDR réels) -> facture.
 *
 * Deux profils : la logistique pilote, un administrateur observe la même mission
 * sur un second navigateur. Le polling ne rafraîchit pas l'écran d'une mission :
 * ce qui change chez l'observateur vient de la trame WebSocket, que l'on lit
 * (`mission_status_changed` / `mission_completed`, voir e2e/README.md).
 *
 * Le paiement de la facture reste couvert par `13-mission-invoice-payment`.
 * Données préfixées E2E-MIS1-, supprimées en fin de spec (et à l'ouverture, si un
 * run précédent a planté).
 */

const PREFIX = "E2E-MIS1-";
const HT = 250000;
const TTC = 298125; // TVA 19,25 %

const ids = createIdBag();
let logistics: E2ECredentials;
let observer: E2ECredentials;
let clientId: number;
let stamp = 0;

const token = (label: string) => `${PREFIX}${label}-${Date.now().toString(36)}-${++stamp}`;

function purge(): Promise<void> {
  return purgeJourneyRows(PREFIX);
}

function createVehicle(overrides: { insuranceDoc?: string } = {}) {
  return createLaunchableVehicle(ids, token("V"), overrides);
}

/** Chauffeur au préfixe de la spec : purge() le retrouve, nul besoin de suivre son id. */
function createDriver(cpcStatus = "FORMÉ") {
  return createLaunchableDriver(token("D"), token("EMP"), { cpcStatus });
}

async function missionRow(id: number) {
  const [row] = await db.select().from(missions).where(eq(missions.id, id));
  return row;
}

async function assignmentRow(missionId: number) {
  const [row] = await db.select().from(assignments).where(eq(assignments.missionId, missionId));
  return row;
}

/** Trames reçues sur la socket `/ws` de la page, à brancher avant toute navigation. */
function captureFrames(page: Page): string[] {
  const frames: string[] = [];
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/ws")) return;
    socket.on("framereceived", (frame) => {
      frames.push(typeof frame.payload === "string" ? frame.payload : frame.payload.toString());
    });
  });
  return frames;
}

const sawStatusFrame = (frames: string[], orderNumber: string, nextStatus: string, type = "mission_status_changed") =>
  frames.some(
    (frame) =>
      frame.includes(type) && frame.includes(orderNumber) && frame.includes(`"nextStatus":"${nextStatus}"`),
  );

test.beforeAll(async () => {
  await purge();
  logistics = await createE2EUser("logistics", ids);
  observer = await createE2EUser("admin", ids);
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  clientId = client.id;
  // Le lancement exige un solde de carte carburant au moins égal au budget carburant.
  await creditFuelCard(ids);
});

test.afterAll(async () => {
  await purge();
  await cleanupCreated(ids);
});

async function createMission(page: Page, orderNumber: string, assignment?: { vehicleId: number; driverId: number }) {
  const created = await page.request.post("/api/missions", {
    data: {
      orderNumber,
      clientId,
      status: "planned",
      pickupAddress: "Douala, port",
      deliveryAddress: "Yaoundé, entrepôt",
      ...(assignment ? { assignment } : {}),
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()) as { id: number; status: string };
}

test.describe("MIS1 : cycle de vie d'une mission au navigateur", () => {
  test("affectation, lancement, livraison, clôture puis facture, observés par un autre rôle", async ({ browser }) => {
    test.setTimeout(420_000);
    const vehicle = await createVehicle();
    const driver = await createDriver();
    const orderNumber = token("MIS");
    const logisticsContext = await newE2EContext(browser, "logistics");
    const observerContext = await newE2EContext(browser, "observer");

    try {
      const page = await logisticsContext.newPage();
      await loginWithSession(page, logistics);
      const mission = await createMission(page, orderNumber);
      expect(mission.status).toBe("planned");

      // Observateur : un autre rôle, une autre session, la même mission ouverte.
      const watcher = await observerContext.newPage();
      const frames = captureFrames(watcher);
      await loginWithSession(watcher, observer);
      await watcher.goto(`/missions/${mission.id}`, { waitUntil: "domcontentloaded" });
      await expect(watcher.getByRole("heading", { name: orderNumber })).toBeVisible({ timeout: 60_000 });
      await expect
        .poll(() => frames.some((frame) => frame.includes("auth_success")), {
          message: "la session observatrice n'a pas ouvert la socket /ws",
          timeout: 20_000,
        })
        .toBe(true);

      // Affectation : écran « Modifier », véhicule et chauffeur réels.
      await page.goto(`/missions/${mission.id}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: orderNumber })).toBeVisible({ timeout: 60_000 });
      await page.getByRole("button", { name: "Modifier", exact: true }).click();
      const vehicleSelect = page.getByTestId("select-edit-vehicle");
      await expect(vehicleSelect.locator(`option[value="${vehicle.id}"]`)).toHaveCount(1, { timeout: 30_000 });
      await vehicleSelect.selectOption(String(vehicle.id));
      const driverSelect = page.getByTestId("select-edit-driver");
      await expect(driverSelect.locator(`option[value="${driver.id}"]`)).toHaveCount(1, { timeout: 30_000 });
      await driverSelect.selectOption(String(driver.id));
      await page.getByTestId("button-save-mission").click();

      await expect.poll(async () => (await missionRow(mission.id)).status, { timeout: 20_000 }).toBe("assigned");
      const assigned = await assignmentRow(mission.id);
      expect(assigned.vehicleId).toBe(vehicle.id);
      expect(assigned.driverId).toBe(driver.id);
      expect(assigned.status).toBe("pending");
      await expect(page.getByText("Assignée", { exact: true }).first()).toBeVisible();

      // Lancement : les budgets manquants sont demandés, puis la mission part.
      await page.getByTestId("button-transition-mission-status-header").click();
      await expect(page.getByTestId("button-save-mission-budgets")).toBeVisible();
      for (const [field, value] of [
        ["fuelBudget", "1000"],
        ["roadExpensesBudget", "5000"],
        ["contingencyBudget", "2000"],
      ] as const) {
        const input = page.getByTestId(`input-mission-budget-${field}`);
        if (await input.isVisible()) await input.fill(value);
      }
      await page.getByTestId("button-save-mission-budgets").click();

      await expect.poll(async () => (await missionRow(mission.id)).status, { timeout: 30_000 }).toBe("in_progress");
      const started = await assignmentRow(mission.id);
      expect(started.status).toBe("in_progress");
      expect(started.startedAt).toBeTruthy();
      await expect(page.getByText("En cours", { exact: true }).first()).toBeVisible();

      // Temps réel : la trame atteint l'autre rôle, puis son écran suit sans rechargement.
      await expect
        .poll(() => sawStatusFrame(frames, orderNumber, "in_progress"), {
          message: "trame mission_status_changed (in_progress) non reçue par l'observateur",
          timeout: 15_000,
        })
        .toBe(true);
      await expect(watcher.getByText("En cours", { exact: true }).first()).toBeVisible({ timeout: 5_000 });

      // Livraison.
      await page.getByTestId("button-transition-mission-status-header").click();
      await expect.poll(async () => (await missionRow(mission.id)).status, { timeout: 30_000 }).toBe("delivered");
      expect((await assignmentRow(mission.id)).completedAt).toBeTruthy();
      await expect
        .poll(() => sawStatusFrame(frames, orderNumber, "delivered"), { timeout: 15_000 })
        .toBe(true);
      await expect(watcher.getByText("Livrée", { exact: true }).first()).toBeVisible({ timeout: 5_000 });

      // Clôture : aucun plein rattaché, motif obligatoire, puis FDR réels.
      await page.getByTestId("button-transition-mission-status-header").click();
      await page.getByTestId("textarea-mission-no-fuel-reason").fill("Mission courte, aucun ravitaillement (e2e).");
      await page.getByTestId("button-declare-no-fuel-and-close").click();
      await page.getByTestId("input-mission-close-fdr").fill("0");
      await page.getByTestId("button-confirm-mission-close-fdr").click();

      await expect.poll(async () => (await missionRow(mission.id)).status, { timeout: 30_000 }).toBe("completed");
      const closed = await missionRow(mission.id);
      expect(closed.completedAt).toBeTruthy();
      expect(JSON.stringify(closed.workflowData)).toContain("actualFdrCost");
      await expect
        .poll(() => sawStatusFrame(frames, orderNumber, "completed", "mission_completed"), {
          message: "trame mission_completed non reçue par l'observateur",
          timeout: 15_000,
        })
        .toBe(true);
      await expect(watcher.getByText("Terminée", { exact: true }).first()).toBeVisible({ timeout: 5_000 });

      // Facture depuis l'écran de la mission clôturée (le règlement est couvert par la spec 13).
      await page.getByTestId("button-open-generate-invoice-dialog").click();
      await page.getByTestId("input-amount").fill(String(HT));
      await page.getByTestId("input-due-date").fill(FAR);
      await page.getByTestId("button-submit-invoice").click();
      await expect(page).toHaveURL(/\/operations\/invoices\/\d+$/, { timeout: 30_000 });
      const [invoice] = await db.select().from(clientInvoices).where(eq(clientInvoices.missionId, mission.id));
      expect(invoice, "facture créée pour la mission clôturée").toBeTruthy();
      expect(Number(invoice.amountHT)).toBe(HT);
      expect(Number(invoice.amountTTC)).toBe(TTC);
      expect(invoice.clientId).toBe(clientId);
    } finally {
      await logisticsContext.close();
      await observerContext.close();
    }
  });
});

test.describe("MIS1 : lancement refusé pour une raison métier", () => {
  const refusals = [
    {
      name: "assurance du véhicule expirée",
      expected: "Assurance manquante ou expirée.",
      setup: async () => ({
        vehicle: await createVehicle({ insuranceDoc: "2020-01-01" }),
        driver: await createDriver(),
      }),
    },
    {
      name: "CPC du chauffeur devenu invalide après l'affectation",
      expected: "CPC non valide (statut : NON FORMÉ). Un chauffeur au statut FORMÉ est requis.",
      setup: async () => ({ vehicle: await createVehicle(), driver: await createDriver() }),
      afterAssign: async (driverId: number) => {
        await db.update(drivers).set({ cpcStatus: "NON FORMÉ" }).where(eq(drivers.id, driverId));
      },
    },
  ];

  for (const refusal of refusals) {
    test(`${refusal.name} : message lisible, mission inchangée`, async ({ browser }) => {
      test.setTimeout(240_000);
      const { vehicle, driver } = await refusal.setup();
      const orderNumber = token("REF");
      const context = await newE2EContext(browser, "profil");

      try {
        const page = await context.newPage();
        await loginWithSession(page, logistics);
        const mission = await createMission(page, orderNumber);
        // Affectation et budgets posés par l'API (planned -> assigned) : ce test porte sur les gardes, pas sur la saisie des budgets.
        const budgets = await page.request.patch(`/api/missions/${mission.id}`, {
          data: {
            assignment: { vehicleId: vehicle.id, driverId: driver.id },
            budget: { fuelBudget: 1000, roadExpensesBudget: 0, contingencyBudget: 0 },
          },
        });
        expect(budgets.ok(), await budgets.text()).toBeTruthy();
        await refusal.afterAssign?.(driver.id);

        await page.goto(`/missions/${mission.id}`, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("heading", { name: orderNumber })).toBeVisible({ timeout: 60_000 });
        await page.getByTestId("button-transition-mission-status-header").click();

        const alert = page.getByRole("alertdialog");
        await expect(alert).toBeVisible({ timeout: 15_000 });
        await expect(alert).toContainText("Impossible de lancer la mission");
        await expect(alert).toContainText(refusal.expected);
        // Lisible : ni gabarit non résolu, ni détail technique.
        const shown = (await alert.innerText()).toLowerCase();
        for (const forbidden of ["undefined", "[object", "sql", "stack", "econn", "violates"]) {
          expect(shown, `le message ne doit pas contenir « ${forbidden} »`).not.toContain(forbidden);
        }

        // La mission n'a pas bougé.
        const after = await missionRow(mission.id);
        expect(after.status).toBe("assigned");
        const assignment = await assignmentRow(mission.id);
        expect(assignment.status).toBe("pending");
        expect(assignment.startedAt).toBeNull();
      } finally {
        await context.close();
      }
    });
  }

  test("après régularisation du document, le même lancement aboutit", async ({ browser }) => {
    test.setTimeout(240_000);
    const vehicle = await createVehicle({ insuranceDoc: "2020-01-01" });
    const driver = await createDriver();
    const orderNumber = token("REG");
    const context = await newE2EContext(browser, "profil");

    try {
      const page = await context.newPage();
      await loginWithSession(page, logistics);
      const mission = await createMission(page, orderNumber);
      const budgets = await page.request.patch(`/api/missions/${mission.id}`, {
        data: {
            assignment: { vehicleId: vehicle.id, driverId: driver.id },
            budget: { fuelBudget: 1000, roadExpensesBudget: 0, contingencyBudget: 0 },
          },
      });
      expect(budgets.ok(), await budgets.text()).toBeTruthy();

      await page.goto(`/missions/${mission.id}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: orderNumber })).toBeVisible({ timeout: 60_000 });
      await page.getByTestId("button-transition-mission-status-header").click();
      await expect(page.getByRole("alertdialog")).toContainText("Assurance manquante ou expirée.");
      expect((await missionRow(mission.id)).status).toBe("assigned");

      await page.keyboard.press("Escape");
      await expect(page.getByRole("alertdialog")).toBeHidden();
      await db
        .update(vehicleDocuments)
        .set({ expiryDate: FAR })
        .where(inArray(vehicleDocuments.vehicleId, [vehicle.id]));

      await page.getByTestId("button-transition-mission-status-header").click();
      await expect.poll(async () => (await missionRow(mission.id)).status, { timeout: 30_000 }).toBe("in_progress");
    } finally {
      await context.close();
    }
  });
});

test.describe("MIS1 : lancement bloqué par un document", () => {
  // Défaut corrigé (client/src/pages/missions/[id].tsx, extractApiError) : le client lisait les motifs
  // dans `payload.details`, alors que PUT /api/missions/:id/status les renvoie dans `message` et
  // `errors` ; l'action « Créer demande de renouvellement » n'était jamais proposée. Le témoin (le refus s'affiche bien, avec son
  // motif) est le cas « assurance du véhicule expirée » ci-dessus.
  test.describe.configure({ timeout: 240_000 });
  let blocked: { id: number };

  test.beforeAll(async ({ browser }) => {
    const vehicle = await createVehicle({ insuranceDoc: "2020-01-01" });
    const driver = await createDriver();
    const context = await newE2EContext(browser, "profil");
    try {
      const page = await context.newPage();
      await loginWithSession(page, logistics);
      blocked = await createMission(page, token("RNW"));
      const patched = await page.request.patch(`/api/missions/${blocked.id}`, {
        data: {
          assignment: { vehicleId: vehicle.id, driverId: driver.id },
          budget: { fuelBudget: 1000, roadExpensesBudget: 0, contingencyBudget: 0 },
        },
      });
      expect(patched.ok(), await patched.text()).toBeTruthy();
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }) => {
    await loginWithSession(page, logistics);
  });

  test("lancement bloqué par un document : la demande de renouvellement est proposée", async ({ page }) => {
    await page.goto(`/missions/${blocked.id}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("button-transition-mission-status-header").click();
    await expect(
      page.getByRole("alertdialog").getByRole("button", { name: "Créer demande de renouvellement" }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
