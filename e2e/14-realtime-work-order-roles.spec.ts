import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { workOrders } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestVehicle } from "../tests/support/factories";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";

/**
 * WO1, WO7 et T6, niveau E, deux comptes de rôles différents créés par la spec
 * (`createE2EUser`, contrairement à la spec 06 qui exige des comptes déjà en base) :
 * le chef d'atelier crée un OT affecté au technicien, le technicien le démarre.
 *
 * On vérifie la TRAME WebSocket reçue par l'autre profil, pas l'écran : la liste
 * des OT se rafraîchit toutes les 7 s, une assertion d'écran plus tardive serait
 * satisfaite par le polling (AGENTS.md §3, e2e/README.md).
 */

const ids = createIdBag();
let manager: E2ECredentials & { id: number };
let technician: E2ECredentials & { id: number };
let otherTechnician: E2ECredentials & { id: number };
const workOrderIds: number[] = [];

test.beforeAll(async () => {
  manager = await createE2EUser("workshop_manager", ids);
  technician = await createE2EUser("technician", ids);
  otherTechnician = await createE2EUser("technician", ids);
  technician.label = "technicien affecté";
  otherTechnician.label = "autre technicien";
});

test.afterAll(async () => {
  for (const id of workOrderIds) {
    try {
      await db.delete(workOrders).where(eq(workOrders.id, id));
    } catch (error) {
      console.warn(`ménage e2e : OT ${id} non supprimé`, error);
      throw new Error(`ménage e2e : OT ${id} non supprimé`, { cause: error });
    }
  }
  await cleanupCreated(ids);
});

/** Ouvre l'application et capture les trames reçues sur /ws, avant toute navigation. */
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
  return { page, frames };
}

const frameOf = (frames: string[], type: string, title: string) =>
  frames.some((f) => f.includes(type) && f.includes(title));

test.describe("Temps réel OT entre chef d'atelier et technicien", () => {
  test("WO1, WO7, T6 : création puis démarrage, trame reçue par l'autre rôle", async ({ browser }) => {
    test.setTimeout(240_000);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const techContext = await browser.newContext();
    const managerContext = await browser.newContext();
    const otherContext = await browser.newContext();
    const title = `E2E-RT-ROLES-${Date.now()}`;

    try {
      const tech = await observe(techContext, technician);
      const boss = await observe(managerContext, manager);
      const other = await observe(otherContext, otherTechnician);

      // Le chef d'atelier crée l'OT et l'affecte au technicien.
      const created = await boss.page.request.post("/api/work-orders", {
        data: {
          vehicleId: vehicle.id,
          title,
          description: "OT temps réel inter-rôles",
          status: "pending",
          priority: "medium",
          startDate: new Date().toISOString(),
          isPreventive: false,
          technicianId: technician.id,
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const workOrderId = (await created.json()).id as number;
      workOrderIds.push(workOrderId);

      await expect
        .poll(() => frameOf(tech.frames, "work_order_created", title), {
          message: "trame work_order_created non reçue par le technicien",
          timeout: 15_000,
        })
        .toBe(true);

      // WO7, chef -> technicien : une alerte nominative d'affectation est écrite.
      await expect
        .poll(async () => {
          const res = await tech.page.request.get("/api/alerts");
          return res.ok() ? JSON.stringify(await res.json()).includes(title) : false;
        }, { message: "alerte d'affectation absente chez le technicien", timeout: 15_000 })
        .toBe(true);

      // Un autre technicien ne peut pas démarrer cet OT.
      const refused = await other.page.request.patch(`/api/technician/work-orders/${workOrderId}/status`, {
        data: { status: "in_progress" },
      });
      expect(refused.status()).toBe(403);

      // Le technicien affecté démarre l'OT : le chef d'atelier reçoit la trame.
      const started = await tech.page.request.patch(`/api/technician/work-orders/${workOrderId}/status`, {
        data: { status: "in_progress" },
      });
      expect(started.status(), await started.text()).toBe(200);

      await expect
        .poll(() => frameOf(boss.frames, "work_order_updated", title), {
          message: "trame work_order_updated non reçue par le chef d'atelier",
          timeout: 15_000,
        })
        .toBe(true);

      const [row] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
      expect(row.status).toBe("in_progress");
    } finally {
      await techContext.close();
      await managerContext.close();
      await otherContext.close();
    }
  });
});
