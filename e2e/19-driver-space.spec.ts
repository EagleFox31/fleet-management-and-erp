import { expect, test, type Browser, type Page } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "../server/db";
import { assignments, clients, drivers, incidents, missions, users, vehicles, workOrders } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestClient, createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../tests/support/factories";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { toastTitle } from "./helpers/toast";
import { newE2EContext } from "./helpers/contexts";

/**
 * DRV2, niveau E : l'espace chauffeur (application mobile, `client/src/pages/driver/dashboard.tsx`).
 *
 * Vert : chaque chauffeur voit sa mission active sur son tableau de bord, jamais celle d'un autre.
 *
 * Défauts DRV2 (constats de docs/qa/PLAN_COUVERTURE_MODULES.md), corrigés et verrouillés par des tests ordinaires :
 * - DRV2-1 : la déclaration de panne poste sur POST /api/driver/breakdowns (le chauffeur n'a pas accès à POST /api/alerts) ;
 * - DRV2-2 : la panne crée un OT ; le chef d'atelier reçoit la trame `work_order_created` (jouée à deux rôles) ;
 * - DRV2-3 : cloison chauffeur sur GET /api/missions, /api/missions/:id et /api/drivers/:id/missions.
 *
 * - DRV2-4 (corrigé) : aucune vue « missions du jour ». Le tableau de bord ne gardait que
 *   `allMissions.find(assigned | in_progress)` (client/src/pages/driver/dashboard.tsx) : un chauffeur qui a deux
 *   missions à faire n'en voyait qu'une, alors que /api/drivers/me les renvoie toutes les deux. Les suivantes
 *   sont désormais listées sous la mission active (`splitDriverMissions`, client/src/lib/driver-missions.ts) ;
 * - DRV2-5 : la déclaration de panne reste dans le périmètre du chauffeur (autre véhicule : 403, corps invalide : 400,
 *   rôle atelier : 403), sans OT créé à tort.
 *
 * Données préfixées E2E-DRV2-, supprimées en fin de spec (et à l'ouverture si un run a planté).
 */

const PREFIX = "E2E-DRV2-";
const ids = createIdBag();
let stamp = 0;

type Crew = { user: E2ECredentials & { id: number }; driverId: number; vehicleId: number; registration: string; missionId: number; orderNumber: string };
let crewA: Crew;
let crewB: Crew;
let crewC: Crew;
let crewCSecond: { missionId: number; orderNumber: string };
let crewD: Crew;
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
    // Une panne crée un incident et un OT (DRV2-2) : ils partent avec le véhicule de test.
    await db.delete(incidents).where(inArray(incidents.vehicleId, vehicleIds));
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

/** Une seconde mission à faire pour le même chauffeur, sur un autre véhicule. */
async function addSecondMission(crew: Crew, clientId: number): Promise<{ missionId: number; orderNumber: string }> {
  const orderNumber = token("MIS2");
  const [mission] = await db
    .insert(missions)
    .values({ clientId, orderNumber, status: "assigned", pickupAddress: "Bafoussam", deliveryAddress: "Garoua" })
    .returning();
  const vehicle = await createTestVehicle({ registrationNumber: `${PREFIX}C2${Date.now().toString(36)}`.slice(0, 32) });
  ids.vehicleIds.push(vehicle.id);
  await db.insert(assignments).values({ missionId: mission.id, vehicleId: vehicle.id, driverId: crew.driverId, status: "accepted" });
  return { missionId: mission.id, orderNumber };
}

async function openSession(browser: Browser, credentials: E2ECredentials, before?: (page: Page) => void): Promise<Page> {
  const context = await newE2EContext(browser, "profil");
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

async function showDashboard(page: Page, crew: Crew): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(`#${crew.orderNumber}`)).toBeVisible({ timeout: 60_000 });
}

/**
 * Déclare une panne depuis le tableau de bord ; renvoie le statut HTTP de l'envoi et son corps.
 * Le corps sert au message d'échec : DRV2-1 a été rouge une fois sans trace (non reproduit en 14 passages),
 * un prochain rouge doit dire seul s'il vient du produit (4xx/5xx motivé) ou des données (véhicule purgé).
 */
async function declareBreakdown(page: Page): Promise<{ status: number; body: string }> {
  await page.getByRole("button", { name: "Signaler un problème" }).click();
  await page.getByRole("button", { name: /Panne véhicule/ }).click();
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/(alerts|incidents|driver\/breakdowns)/.test(r.url())),
    page.getByRole("button", { name: "Envoyer le signalement" }).click(),
  ]);
  const status = response.status();
  // Corps lu seulement en échec, et borné : `response.text()` ne rend jamais la main sur une réponse
  // passée par le service worker PWA (constaté sur un 201, le test restait bloqué jusqu'au timeout).
  if (status < 300) return { status, body: "" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const body = await Promise.race([
    response.text().catch(() => "(corps illisible)"),
    new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve("(corps non lu en 5 s)"), 5_000);
    }),
  ]).finally(() => clearTimeout(timer));
  return { status, body };
}

/** Trame `work_order_created` dont le payload vise ce véhicule (les payloads portent `vehicleId`, pas l'immatriculation, quelle que soit leur enveloppe). */
function isWorkOrderCreatedFor(frame: string, vehicleId: number): boolean {
  return frame.includes("work_order_created") && new RegExp(String.raw`"vehicleId"\s*:\s*${vehicleId}(?!\d)`).test(frame);
}

test.beforeAll(async () => {
  await purge();
  const client = await createTestClient({ name: token("CLIENT") });
  ids.clientIds.push(client.id);
  crewA = await createCrew("A", client.id);
  crewB = await createCrew("B", client.id);
  crewC = await createCrew("C", client.id);
  crewCSecond = await addSecondMission(crewC, client.id);
  crewD = await createCrew("D", client.id);
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
        await showDashboard(page, own);
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

  // Les `test.fail` ne portent que l'action visée et l'assertion (tests/unit/server/it-fails-hygiene.test.ts) :
  // sessions et navigation sont posées dans les hooks, avec leurs propres assertions.

  test.describe("DRV2-1 : déclaration de panne", () => {
    test.beforeEach(async ({ page }) => {
      await loginWithSession(page, crewA.user);
      await showDashboard(page, crewA);
    });

    // Témoin : un `test.fail` passe aussi quand sa mise en place échoue (coupure Neon, connexion refusée).
    // Ce test ordinaire partage les mêmes hooks et vire au rouge dans ce cas.
    test("DRV2-1 : mise en place réussie (témoin)", () => {});

    test("DRV2-1 : la déclaration de panne du chauffeur est acceptée", async ({ page }) => {
      const { status, body } = await declareBreakdown(page);
      expect(status, `POST de la panne : ${body.slice(0, 300)}`).toBeLessThan(300);
      // Région des toasts seulement : Radix répète le titre dans un `status` aria-live (voir helpers/toast.ts).
      await expect(toastTitle(page, "Problème signalé")).toBeVisible();
    });
  });

  test.describe("DRV2-2 : la panne crée un OT vu par l'atelier", () => {
    let frames: string[] = [];
    let atelier: Page;
    let driverPage: Page;

    test.beforeEach(async ({ browser }) => {
      atelier = await openSession(browser, workshop, (page) => {
        frames = captureFrames(page);
      });
      await atelier.goto("/maintenance/work-orders", { waitUntil: "domcontentloaded" });
      await expect
        .poll(() => frames.some((frame) => frame.includes("auth_success")), {
          message: "la session atelier n'a pas ouvert la socket /ws",
          timeout: 60_000,
        })
        .toBe(true);
      driverPage = await openSession(browser, crewB.user);
      await showDashboard(driverPage, crewB);
    });

    test.afterEach(async () => {
      await atelier?.context().close();
      await driverPage?.context().close();
    });

    // Témoin : un `test.fail` passe aussi quand sa mise en place échoue (coupure Neon, connexion refusée).
    // Ce test ordinaire partage les mêmes hooks et vire au rouge dans ce cas.
    test("DRV2-2 : mise en place réussie (témoin)", () => {});

    test("DRV2-2 : une panne crée un OT, reçu en temps réel par l'atelier", async () => {
      await declareBreakdown(driverPage);
      // Preuve temps réel : une trame, que le polling de la liste ne peut pas produire.
      await expect
        .poll(() => frames.some((frame) => isWorkOrderCreatedFor(frame, crewB.vehicleId)), {
          message: "trame work_order_created absente côté atelier",
          timeout: 15_000,
        })
        .toBe(true);
      const rows = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.vehicleId, crewB.vehicleId));
      expect(rows).toHaveLength(1);
      await expect(atelier.getByText(crewB.registration).first()).toBeVisible();
    });
  });

  test.describe("DRV2-3 : cloison entre chauffeurs à l'API", () => {
    test.beforeEach(async ({ page }) => {
      await loginWithSession(page, crewA.user);
    });

    // Témoin : un `test.fail` passe aussi quand sa mise en place échoue (coupure Neon, connexion refusée).
    // Ce test ordinaire partage les mêmes hooks et vire au rouge dans ce cas.
    test("DRV2-3 : mise en place réussie (témoin)", () => {});

    test("DRV2-3 : GET /api/missions/:id d'un autre chauffeur est refusé (403)", async ({ page }) => {
      const res = await page.request.get(`/api/missions/${crewB.missionId}`);
      expect(res.status()).toBe(403);
    });

    test("DRV2-3 : GET /api/missions ne liste pas la mission d'un autre chauffeur", async ({ page }) => {
      const res = await page.request.get("/api/missions");
      expect(res.status()).toBe(200);
      const list = (await res.json()) as { id: number }[];
      expect(list.map((m) => m.id)).not.toContain(crewB.missionId);
    });

    test("DRV2-3 : GET /api/drivers/:id/missions d'un autre chauffeur est refusé (403)", async ({ page }) => {
      const res = await page.request.get(`/api/drivers/${crewB.driverId}/missions`);
      expect(res.status()).toBe(403);
    });
  });

  test.describe("DRV2-4 : vue des missions du jour", () => {
    test.beforeEach(async ({ page }) => {
      await loginWithSession(page, crewC.user);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "Signaler un problème" })).toBeVisible({ timeout: 60_000 });
    });

    // Témoin : un `test.fail` passe aussi quand sa mise en place échoue (coupure Neon, connexion refusée).
    // Ce test ordinaire partage les mêmes hooks et vire au rouge dans ce cas.
    test("DRV2-4 : mise en place réussie (témoin)", async ({ page }) => {
      // L'API fournit bien les deux missions : le défaut est dans l'écran.
      const me = (await (await page.request.get("/api/drivers/me")).json()) as { missions: { id: number }[] };
      expect(me.missions.map((m) => m.id).sort()).toEqual([crewC.missionId, crewCSecond.missionId].sort());
      // L'écran en montre au moins une.
      const shown = [crewC.orderNumber, crewCSecond.orderNumber].filter(Boolean);
      await expect(page.getByText(new RegExp(shown.join("|"))).first()).toBeVisible();
    });

    // DRV2-4 corrigé : la première mission à faire est la mission active, les suivantes sont listées sous elle.
    test("DRV2-4 : les deux missions à faire sont visibles sur le tableau de bord", async ({ page }) => {
      await expect(page.getByText(`#${crewC.orderNumber}`)).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText(`#${crewCSecond.orderNumber}`)).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe("DRV2-5 : périmètre de la déclaration de panne", () => {
    const workOrdersOf = (vehicleId: number) => db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.vehicleId, vehicleId));

    test.beforeEach(async ({ page }) => {
      await loginWithSession(page, crewD.user);
    });

    test("DRV2-5 : mise en place réussie (témoin)", async ({ page }) => {
      expect((await page.request.get("/api/drivers/me")).status()).toBe(200);
    });

    test("DRV2-5 : un véhicule hors de ses affectations est refusé, sans OT", async ({ page }) => {
      // Les autres tests de la spec ouvrent déjà un OT sur ce véhicule : on compare avant et après.
      const before = (await workOrdersOf(crewA.vehicleId)).length;
      const res = await page.request.post("/api/driver/breakdowns", {
        data: { type: "breakdown", vehicleId: crewA.vehicleId, description: "Panne sur le véhicule d'un autre", severity: "high" },
      });
      expect(res.status()).toBe(403);
      expect(await workOrdersOf(crewA.vehicleId)).toHaveLength(before);
    });

    test("DRV2-5 : un corps invalide donne 400, jamais 500", async ({ page }) => {
      const res = await page.request.post("/api/driver/breakdowns", { data: { type: "breakdown" } });
      expect(res.status()).toBe(400);
      expect(await workOrdersOf(crewD.vehicleId)).toHaveLength(0);
    });

    test("DRV2-5 : le chef d'atelier n'a pas accès à la déclaration chauffeur", async ({ browser }) => {
      const page = await openSession(browser, workshop);
      try {
        const res = await page.request.post("/api/driver/breakdowns", {
          data: { type: "breakdown", vehicleId: crewD.vehicleId, description: "Déclaration par l'atelier", severity: "high" },
        });
        expect(res.status()).toBe(403);
        expect(await workOrdersOf(crewD.vehicleId)).toHaveLength(0);
      } finally {
        await page.context().close();
      }
    });
  });
});

/**
 * Fiche chauffeur : mise à jour du CPC par un gestionnaire (logistique), avec un observateur d'un autre rôle.
 * Le formulaire n'est pas proposé aux rôles que la route refuserait (direction : refusée par la route de la fiche).
 */
test.describe("DRV2-6 : fiche chauffeur, mise à jour du CPC", () => {
  let target: Crew;
  let logistics: E2ECredentials & { id: number };
  let direction: E2ECredentials & { id: number };

  test.beforeAll(async () => {
    const client = await createTestClient({ name: token("CLI6") });
    ids.clientIds.push(client.id);
    target = await createCrew("F", client.id);
    logistics = await createAccount("logistics", "LOGI");
    direction = await createAccount("management", "DIR");
  });

  test("la logistique met à jour le CPC depuis la fiche, l'atelier reçoit la trame", async ({ browser }) => {
    let frames: string[] = [];
    const atelier = await openSession(browser, workshop, (page) => {
      frames = captureFrames(page);
    });
    const manager = await openSession(browser, logistics);
    try {
      await atelier.goto("/maintenance/work-orders", { waitUntil: "domcontentloaded" });
      await expect
        .poll(() => frames.some((frame) => frame.includes("auth_success")), {
          message: "la session atelier n'a pas ouvert la socket /ws",
          timeout: 60_000,
        })
        .toBe(true);

      await manager.goto(`/drivers/${target.driverId}`, { waitUntil: "domcontentloaded" });
      await manager.getByRole("tab", { name: /Informations/ }).click();
      await expect(manager.getByTestId(`btn-update-cpc-${target.driverId}`)).toBeVisible({ timeout: 60_000 });
      await expect(manager.getByText("NON FORMÉ").first()).toBeVisible();

      const today = new Date().toISOString().split("T")[0];
      await manager.getByTestId(`input-cpc-date-${target.driverId}`).fill(today);
      const [response] = await Promise.all([
        manager.waitForResponse(
          (r) => r.request().method() === "POST" && r.url().includes(`/api/drivers/${target.driverId}/update-cpc`),
        ),
        manager.getByTestId(`btn-update-cpc-${target.driverId}`).click(),
      ]);
      expect(response.status()).toBe(200);

      // Preuve temps réel : une trame reçue par l'autre profil, que le polling ne peut pas produire.
      await expect
        .poll(() => frames.some((frame) => frame.includes("driver_cpc_updated") && frame.includes(`${target.driverId}`)), {
          message: "trame driver_cpc_updated absente côté atelier",
          timeout: 15_000,
        })
        .toBe(true);
      // La fiche est rafraîchie par invalidation du détail.
      await expect(manager.getByText("FORMÉ", { exact: true }).first()).toBeVisible();
    } finally {
      await atelier.context().close();
      await manager.context().close();
    }
  });

  test("la direction est refusée sur la fiche, sans formulaire", async ({ browser }) => {
    const atelier = await openSession(browser, direction);
    try {
      await atelier.goto(`/drivers/${target.driverId}`, { waitUntil: "domcontentloaded" });
      // La route /drivers/:id est réservée à DRIVER_MANAGER_ROLES : la direction n'atteint pas la fiche.
      await expect(atelier.getByText("Accès refusé", { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(atelier.getByTestId(`btn-update-cpc-${target.driverId}`)).toHaveCount(0);
    } finally {
      await atelier.context().close();
    }
  });
});
