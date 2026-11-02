import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { workOrders } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestVehicle } from "../tests/support/factories";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";

/**
 * T6, WO1 et WO7, niveau E : deux comptes de rôles différents créés par la spec
 * (chef d'atelier et technicien).
 *
 * Le chef d'atelier garde ouvert son tableau de bord ("/"). Ses requêtes
 * (`/api/work-orders/statistics`, `/api/work-orders`) n'ont AUCUN polling
 * (`refetchInterval: false`, `client/src/lib/queryClient.ts`) : une requête de
 * refetch observée après l'action du technicien ne peut venir que de
 * l'invalidation déclenchée par la trame WebSocket (règle des 3 couches,
 * AGENTS.md §2). On vérifie donc la trame ET la requête, dans un délai inférieur
 * à l'intervalle de polling des listes d'OT (7 s).
 */

const POLLING_MS = 7_000;
const REFETCH_BUDGET_MS = 5_000;
const STATS = "/api/work-orders/statistics";
const LIST = "/api/work-orders";

const ids = createIdBag();
const workOrderIds: number[] = [];
let manager: E2ECredentials & { id: number };
let technician: E2ECredentials & { id: number };

test.beforeAll(async () => {
  manager = await createE2EUser("workshop_manager", ids);
  technician = await createE2EUser("technician", ids);
  manager.label = "chef d'atelier";
  technician.label = "technicien affecté";
});

test.afterAll(async () => {
  for (const id of workOrderIds) {
    await db.delete(workOrders).where(eq(workOrders.id, id));
  }
  await cleanupCreated(ids);
});

async function observe(context: BrowserContext, credentials: E2ECredentials) {
  const page = await context.newPage();
  const frames: string[] = [];
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/ws")) return;
    socket.on("framereceived", (frame) => {
      frames.push(typeof frame.payload === "string" ? frame.payload : frame.payload.toString());
    });
  });
  await loginWithSession(page, credentials);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect
    .poll(() => frames.some((f) => f.includes("auth_success")), {
      message: `socket temps réel non établie pour ${credentials.label}`,
      timeout: 60_000,
    })
    .toBe(true);
  // Requêtes GET émises par l'application elle-même (pas par page.request), horodatées.
  const requests: { path: string; at: number }[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET") requests.push({ path: new URL(request.url()).pathname, at: Date.now() });
  });
  return { page, frames, requests };
}

const frameOf = (frames: string[], type: string, needle: string) =>
  frames.some((f) => f.includes(type) && f.includes(needle));

/**
 * Attend, au plus REFETCH_BUDGET_MS après le retour de l'action, une requête de l'application vers
 * `path` émise depuis `since`. Horodatage plutôt que waitForRequest : une action lente sur la
 * base distante ne consomme pas le budget.
 */
async function expectRefetch(requests: { path: string; at: number }[], path: string, since: number) {
  await expect
    .poll(() => requests.some((r) => r.path === path && r.at >= since), {
      message: `aucun refetch de ${path} après la transition`,
      timeout: REFETCH_BUDGET_MS,
    })
    .toBe(true);
}

async function createWorkOrder(boss: Page, vehicleId: number, title: string, technicianId: number) {
  const created = await boss.request.post("/api/work-orders", {
    data: {
      vehicleId,
      title,
      description: "OT temps réel, écrans satellites",
      status: "pending",
      priority: "medium",
      startDate: new Date().toISOString(),
      isPreventive: false,
      technicianId,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).id as number;
  workOrderIds.push(id);
  return id;
}

test.describe("T6, WO1 : transitions d'OT et écrans satellites du chef d'atelier", () => {
  test("chaque transition invalide statistiques et liste chez le chef avant le polling", async ({ browser }) => {
    test.setTimeout(240_000);
    expect(REFETCH_BUDGET_MS).toBeLessThan(POLLING_MS);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const bossContext = await browser.newContext();
    const techContext = await browser.newContext();
    const title = `E2E-RT-SAT-${Date.now()}`;

    try {
      const boss = await observe(bossContext, manager);
      const tech = await observe(techContext, technician);

      // Le tableau de bord du chef a chargé ses données une première fois.
      await boss.page.waitForLoadState("networkidle");

      // WO1 : seul le chef d'atelier crée. Le technicien est refusé.
      const refusedCreate = await tech.page.request.post("/api/work-orders", {
        data: { vehicleId: vehicle.id, title: `${title}-refus`, status: "pending", priority: "low", isPreventive: false },
      });
      expect(refusedCreate.status()).toBe(403);

      // Création (T6 : trame chez le technicien, refetch chez le chef lui-même).
      const sinceCreate = Date.now();
      const workOrderId = await createWorkOrder(boss.page, vehicle.id, title, technician.id);
      await expectRefetch(boss.requests, STATS, sinceCreate);
      await expect
        .poll(() => frameOf(tech.frames, "work_order_created", title), { timeout: 15_000 })
        .toBe(true);

      // Démarrage par le technicien affecté : trame + refetch statistiques ET liste chez le chef.
      const sinceStart = Date.now();
      const started = await tech.page.request.patch(`/api/technician/work-orders/${workOrderId}/status`, {
        data: { status: "in_progress" },
      });
      expect(started.status(), await started.text()).toBe(200);
      await expect
        .poll(() => frameOf(boss.frames, "work_order_updated", title), { timeout: 15_000 })
        .toBe(true);
      await expectRefetch(boss.requests, STATS, sinceStart);
      await expectRefetch(boss.requests, LIST, sinceStart);

      // Fin d'intervention par le technicien : même chaîne.
      const sinceDone = Date.now();
      const done = await tech.page.request.patch(`/api/technician/work-orders/${workOrderId}/status`, {
        data: { status: "completed" },
      });
      expect(done.status(), await done.text()).toBe(200);
      await expectRefetch(boss.requests, STATS, sinceDone);
      const [completed] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
      expect(completed.status).toBe("completed");

      // Correction du titre par le chef : le technicien reçoit la trame (nouveau titre).
      const renamed = `${title}-corrigé`;
      const edit = await boss.page.request.patch(`/api/work-orders/${workOrderId}`, { data: { title: renamed } });
      expect(edit.status(), await edit.text()).toBe(200);
      await expect
        .poll(() => frameOf(tech.frames, "work_order_updated", renamed), { timeout: 15_000 })
        .toBe(true);

      // Suppression : le technicien ne peut pas, le chef le peut, et le technicien est prévenu.
      const refusedDelete = await tech.page.request.delete(`/api/work-orders/${workOrderId}`);
      expect(refusedDelete.status()).toBe(403);
      const sinceDelete = Date.now();
      const removed = await boss.page.request.delete(`/api/work-orders/${workOrderId}`);
      expect([200, 204]).toContain(removed.status());
      await expect
        .poll(() => tech.frames.some((f) => f.includes("work_order_deleted") && f.includes(String(workOrderId))), {
          timeout: 15_000,
        })
        .toBe(true);
      await expectRefetch(boss.requests, STATS, sinceDelete);
    } finally {
      await bossContext.close();
      await techContext.close();
    }
  });
});

/**
 * WO7, technicien vers chef : l'alerte nominative « Intervention démarrée ».
 * La mise en place (OT, démarrage, sessions) est dans `beforeAll` ; le corps du
 * `test.fail` ne contient que la lecture des alertes du chef et l'assertion.
 */
test.describe.serial("WO7 : alerte d'avancement vers le chef d'atelier", () => {
  let bossPage: Page;
  let bossContext: BrowserContext;
  let workOrderId: number;
  let startedStatus = 0;
  const title = `E2E-RT-ALERT-${Date.now()}`;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    bossContext = await browser.newContext();
    const techContext = await browser.newContext();
    try {
      const boss = await observe(bossContext, manager);
      bossPage = boss.page;
      const tech = await observe(techContext, technician);
      workOrderId = await createWorkOrder(boss.page, vehicle.id, title, technician.id);
      const started = await tech.page.request.patch(`/api/technician/work-orders/${workOrderId}/status`, {
        data: { status: "in_progress" },
      });
      startedStatus = started.status();
    } finally {
      await techContext.close();
    }
  });

  test.afterAll(async () => {
    await bossContext?.close();
  });

  test("témoin : le démarrage a réussi et le chef a reçu la trame", async () => {
    expect(startedStatus).toBe(200);
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
    expect(row.status).toBe("in_progress");
  });

  // Défaut produit : `PATCH /api/technician/work-orders/:id/status`
  // (server/api/technician-work-orders.routes.ts) diffuse `work_order_updated` mais
  // n'appelle jamais `alertService.notifyWorkOrderProgress` (appelé seulement par
  // `PATCH /api/work-orders/:id`, server/routes.ts:2321). Le chef d'atelier n'a donc
  // aucune alerte nominative quand le technicien démarre depuis son écran.
  test.fail("le chef d'atelier reçoit l'alerte « Intervention démarrée »", async () => {
    await expect
      .poll(
        async () => {
          const res = await bossPage.request.get("/api/alerts");
          return res.ok() ? JSON.stringify(await res.json()).includes(`Intervention démarrée — OT #${workOrderId}`) : false;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  });
});

