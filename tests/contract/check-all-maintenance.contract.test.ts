import { gt, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { workOrders } from "../../shared/schema";
import { startContractSession } from "../support/contract-session";

/**
 * POST /api/check-all-maintenance : comportement figé avant la suppression de la
 * déclaration doublon de `server/routes.ts`. La première déclaration, servie, répond
 * `{ success, message, details: { kilometerBased, dateBased, total, statusReconciliation } }` ;
 * la seconde (morte) répondait `totalWorkOrdersGenerated`, forme jamais reçue par le client.
 *
 * L'appel réel crée des ordres de travail pour les plans échus de la base : ils sont
 * supprimés en fin de suite (identifiants postérieurs au maximum relevé avant l'appel).
 */

type Actor = "manager" | "technician";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
let maxWorkOrderIdBefore = 0;

async function maxWorkOrderId(): Promise<number> {
  const [row] = await db.select({ max: sql<number>`coalesce(max(${workOrders.id}), 0)` }).from(workOrders);
  return Number(row.max);
}

beforeAll(async () => {
  session = await startContractSession<Actor>({ manager: "workshop_manager", technician: "technician" });
  maxWorkOrderIdBefore = await maxWorkOrderId();
}, 60000);

afterAll(async () => {
  await db.delete(workOrders).where(gt(workOrders.id, maxWorkOrderIdBefore));
  await session.stop();
});

describe("maintenance préventive : vérification globale", { timeout: 60000 }, () => {
  it("refuse sans session (401) et à un technicien (403)", async () => {
    const anonymous = await session.call("POST", "/api/check-all-maintenance", { actor: null });
    expect(anonymous.status).toBe(401);
    const technician = await session.call("POST", "/api/check-all-maintenance", { actor: "technician" });
    expect(technician.status).toBe(403);
  });

  it("répond au chef d'atelier avec le détail kilométrage / dates / réconciliation", async () => {
    const res = await session.call("POST", "/api/check-all-maintenance", { actor: "manager" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/^Vérification terminée\. \d+ nouveaux ordres de travail créés\.$/);
    const { details } = res.body;
    expect(typeof details.kilometerBased.workOrdersCreated).toBe("number");
    expect(typeof details.dateBased.workOrdersCreated).toBe("number");
    expect(details.total).toBe(details.kilometerBased.workOrdersCreated + details.dateBased.workOrdersCreated);
    expect(details.statusReconciliation).toBeDefined();
    expect(res.body).not.toHaveProperty("totalWorkOrdersGenerated");
  });
});
