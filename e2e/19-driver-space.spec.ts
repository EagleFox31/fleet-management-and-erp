import { expect, test, type Browser, type Page } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "../server/db";
import { assignments, clients, drivers, missions, users, vehicles, workOrders } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestClient, createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../tests/support/factories";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";

/**
 * DRV2, niveau E : l'espace chauffeur (application mobile, `client/src/pages/driver/dashboard.tsx`).
 *
 * Vert : chaque chauffeur voit sa mission active sur son tableau de bord, jamais celle d'un autre.
 *
 * Défauts figés par `test.fail` (constats de docs/qa/PLAN_COUVERTURE_MODULES.md, DRV2) :
 * - DRV2-1 : la déclaration de panne poste sur POST /api/alerts, réservé à isWorkshopManager
 *   (server/routes.ts:4286) : 403 pour le chauffeur (client/src/pages/driver/dashboard.tsx:241) ;
 * - DRV2-2 : aucune panne ne crée d'OT (POST /api/incidents est derrière le drapeau `incidents`,
 *   désactivé, shared/feature-flags.ts:34, et ne crée pas d'OT, server/services/incident-service.ts:135-151).
 *   L'attente est jouée à deux rôles : le chef d'atelier doit recevoir la trame `work_order_created` ;
 * - DRV2-3 : pas de cloison chauffeur sur GET /api/missions et /api/missions/:id
 *   (server/api/missions.routes.ts:589 et :692) ni sur /api/drivers/:id/missions
 *   (server/api/drivers-management.routes.ts:164). /api/drivers/me, lui, est cloisonné.
 *
 * Données préfixées E2E-DRV2-, supprimées en fin de spec (et à l'ouverture si un run a planté).
 */

const PREFIX = "E2E-DRV2-";
const ids = createIdBag();
let stamp = 0;

type Crew = { user: E2ECredentials & { id: number }; driverId: number; vehicleId: number; registration: string; missionId: number; orderNumber: string };
let crewA: Crew;
let crewB: Crew;
let workshop: E2ECredentials & { id: number };

const token = (label: string) => `${PREFIX}${label}-${Date.now().toString(36)}-${++stamp}`;

async function purge(): Promise<void> {
  const missionRows = await db.select({ id: missions.id }).from(missions).where(like(missions.orderNumber, `${PREFIX}%`));
  const missionIds = missionRows.map((row) => row.id);
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  const vehicleRows = await db.select({ id: vehicles.id }).from(vehicles).where(like(vehicles.registrationNumber, `${PREFIX}%`));
  const vehicleIds = vehicleRows.map((row) => row.id);
  if (vehicleIds.length > 0) {
    // Le jour où une panne crée un OT (DRV2-2), il part avec le véhicule de test.
    await db.delete(workOrders).where(inArray(workOrders.vehicleId, vehicleIds));
    await db.delete(assignments).where(inArray(assignments.vehicleId, vehicleIds));
  }
  await db.delete(drivers).where(like(drivers.lastName, `${PREFIX}%`));
  const bag = createIdBag();
  bag.vehicleIds.push(...vehicleIds);
  bag.clientIds.push(...(await db.select({ id: clients.id }).from(clients).where(like(clients.name, `${PREFIX}%`))).map((r) => r.id));
  bag.userIds.push(...(await db.select({ id: users.id }).from(users).where(like(users.username, `${PREFIX}%`))).map((r) => r.id));
  await cleanupCreated(bag);
}

async function createAccount(role: TestUserRole, label: string): Promise<E2ECredentials & { id: number }> {
  const name = token(label);
  const user = await createTestUser({ role, username: name, name, email: `${name.toLowerCase()}@fleet.test` });
  ids.userIds.push(user.id);
  return { id: user.id, username: user.username, password: TEST_USER_PASSWORD, label };
}

/** Un chauffeur lié à son compte, un véhicule et une mission affectée (statut `assigned`). */
async function createCrew(label: string, clientId: number): Promise<Crew> {
  const user = await createAccount("driver", label);
  const [driver] = await db
    .insert(drivers)
    .values({ userId: user.id, firstName: "Chauffeur", lastName: token(label), employeeNumber: token(`EMP${label}`), isActive: true })
    .returning();
  const registration = `${PREFIX}${label}${Date.now().toString(36)}`.slice(0, 32);
  const vehicle = await createTestVehicle({ registrationNumber: registration });
  ids.vehicleIds.push(vehicle.id);
  const orderNumber = token(`MIS${label}`);
  const [mission] = await db
    .insert(missions)
    .values({ clientId, orderNumber, status: "assigned", pickupAddress: "Douala, port", deliveryAddress: "Yaoundé, entrepôt" })
    .returning();
  await db.insert(assignments).values({ missionId: mission.id, vehicleId: vehicle.id, driverId: driver.id, status: "accepted" });
  return { user, driverId: driver.id, vehicleId: vehicle.id, registration: vehicle.registrationNumber, missionId: mission.id, orderNumber };
}

async function openSession(browser: Browser, credentials: E2ECredentials, before?: (page: Page) => void): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  before?.(page);
  await loginWithSession(page, credentials);
  return page;
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

async function openDashboard(page: Page, crew: Crew): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(`#${crew.orderNumber}`)).toBeVisible({ timeout: 60_000 });
}

/** Déclare une panne depuis le tableau de bord ; renvoie le statut HTTP de l'envoi. */
async function declareBreakdown(page: Page): Promise<number> {
  await page.getByRole("button", { name: "Signaler un problème" }).click();
  await page.getByRole("button", { name: /Panne véhicule/ }).click();
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/(alerts|incidents)/.test(r.url())),
    page.getByRole("button", { name: "Envoyer le signalement" }).click(),
  ]);
  return response.status();
}

test.beforeAll(async () => {
  await purge();
  const client = await createTestClient({ name: token("CLIENT") });
  ids.clientIds.push(client.id);
  crewA = await createCrew("A", client.id);
  crewB = await createCrew("B", client.id);
  workshop = await createAccount("workshop_manager", "ATELIER");
});

test.afterAll(async () => {
  await purge();
  await cleanupCreated(ids);
});

test.describe("DRV2 : espace chauffeur", () => {
  test("chaque chauffeur voit sa mission, pas celle de l'autre", async ({ browser }) => {
    for (const [own, other] of [[crewA, crewB], [crewB, crewA]] as const) {
      const page = await openSession(browser, own.user);
      try {
        await openDashboard(page, own);
        await expect(page.getByText(own.registration).first()).toBeVisible();
        await expect(page.getByText(other.orderNumber)).toHaveCount(0);
        await expect(page.getByText(other.registration)).toHaveCount(0);
        // Source de l'écran : /api/drivers/me, cloisonné au chauffeur connecté.
        const me = (await (await page.request.get("/api/drivers/me")).json()) as { missions: { id: number }[] };
        expect(me.missions.map((m) => m.id)).toEqual([own.missionId]);
      } finally {
        await page.context().close();
      }
    }
  });

  test.fail("DRV2-1 : la déclaration de panne du chauffeur est acceptée", async ({ browser }) => {
    const page = await openSession(browser, crewA.user);
    try {
      await openDashboard(page, crewA);
      const status = await declareBreakdown(page);
      expect(status, "POST de la panne").toBeLessThan(300);
      await expect(page.getByText("Problème signalé")).toBeVisible();
    } finally {
      await page.context().close();
    }
  });

  test.fail("DRV2-2 : une panne crée un OT, reçu en temps réel par l'atelier", async ({ browser }) => {
    test.setTimeout(120_000);
    let frames: string[] = [];
    const atelier = await openSession(browser, workshop, (page) => {
      frames = captureFrames(page);
    });
    const driverPage = await openSession(browser, crewB.user);
    try {
      await atelier.goto("/maintenance/work-orders", { waitUntil: "domcontentloaded" });
      await expect
        .poll(() => frames.some((frame) => frame.includes("auth_success")), {
          message: "la session atelier n'a pas ouvert la socket /ws",
          timeout: 60_000,
        })
        .toBe(true);

      await openDashboard(driverPage, crewB);
      await declareBreakdown(driverPage);

      // Preuve temps réel : une trame, que le polling de la liste ne peut pas produire.
      await expect
        .poll(() => frames.some((frame) => frame.includes("work_order_created") && frame.includes(crewB.registration)), {
          message: "trame work_order_created absente côté atelier",
          timeout: 15_000,
        })
        .toBe(true);
      const created = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.vehicleId, crewB.vehicleId));
      expect(created).toHaveLength(1);
      await expect(atelier.getByText(crewB.registration).first()).toBeVisible();
    } finally {
      await atelier.context().close();
      await driverPage.context().close();
    }
  });

  test.fail("DRV2-3 : GET /api/missions/:id d'un autre chauffeur est refusé (403)", async ({ browser }) => {
    const page = await openSession(browser, crewA.user);
    try {
      expect((await page.request.get(`/api/missions/${crewB.missionId}`)).status()).toBe(403);
    } finally {
      await page.context().close();
    }
  });

  test.fail("DRV2-3 : GET /api/missions ne liste pas la mission d'un autre chauffeur", async ({ browser }) => {
    const page = await openSession(browser, crewA.user);
    try {
      const response = await page.request.get("/api/missions");
      expect(response.status()).toBe(200);
      const body = (await response.json()) as { id: number }[] | { missions?: { id: number }[]; data?: { id: number }[] };
      const list = Array.isArray(body) ? body : body.missions ?? body.data ?? [];
      expect(list.map((m) => m.id)).not.toContain(crewB.missionId);
    } finally {
      await page.context().close();
    }
  });

  test.fail("DRV2-3 : GET /api/drivers/:id/missions d'un autre chauffeur est refusé (403)", async ({ browser }) => {
    const page = await openSession(browser, crewA.user);
    try {
      expect((await page.request.get(`/api/drivers/${crewB.driverId}/missions`)).status()).toBe(403);
    } finally {
      await page.context().close();
    }
  });
});
