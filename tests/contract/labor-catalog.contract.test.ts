import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { laborCatalog, workOrders } from "../../shared/schema";
import { createTestVehicle } from "../support/factories";
import { startContractSession } from "../support/contract-session";
import { uniqueTestToken } from "../support/ids";

/**
 * CAT1, catalogue de main-d'oeuvre : création, lecture, désactivation, droits.
 *
 * Le catalogue n'a que `GET /` et `POST /` : aucune route de modification ni
 * de désactivation (voir le dernier cas, `it.fails`). La désactivation est donc
 * posée par `db.update` pour prouver ce que les consommateurs en font.
 */

type Actor = "manager" | "technician" | "warehouse";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const entryIds: number[] = [];
const workOrderIds: number[] = [];

async function createEntry(overrides: Record<string, unknown> = {}) {
  const code = uniqueTestToken("cat").toLowerCase();
  const res = await session.call("POST", "/api/labor-catalog", {
    actor: "manager",
    body: { code, label: `TEST poste ${code}`, standardHours: 1.5, ...overrides },
  });
  if (res.status === 201) entryIds.push(res.body.id);
  return { res, code };
}

beforeAll(async () => {
  session = await startContractSession<Actor>({ manager: "workshop_manager", technician: "technician", warehouse: "warehouse" });
}, 60000);

afterAll(async () => {
  if (workOrderIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  if (entryIds.length > 0) await db.delete(laborCatalog).where(inArray(laborCatalog.id, entryIds));
  await session.stop();
});

describe("CAT1 : catalogue de main-d'oeuvre", { timeout: 60000 }, () => {
  it("la lecture exige une session, mais pas un rôle précis", async () => {
    expect((await session.call("GET", "/api/labor-catalog", { actor: null })).status).toBe(401);
    expect((await session.call("GET", "/api/labor-catalog", { actor: "technician" })).status).toBe(200);
    expect((await session.call("GET", "/api/labor-catalog", { actor: "warehouse" })).status).toBe(200);
  });

  it("l'écriture est réservée au chef d'atelier (technicien et magasinier : 403, rien écrit)", async () => {
    const code = uniqueTestToken("cat").toUpperCase();
    for (const actor of ["technician", "warehouse"] as const) {
      const res = await session.call("POST", "/api/labor-catalog", { actor, body: { code, label: "TEST refusé" } });
      expect(res.status).toBe(403);
    }
    expect(await db.select({ id: laborCatalog.id }).from(laborCatalog).where(eq(laborCatalog.code, code))).toHaveLength(0);
  });

  it("crée un poste : code en majuscules, libellé nettoyé, auteur tracé, heures conservées", async () => {
    const code = uniqueTestToken("cat").toLowerCase();
    const res = await session.call("POST", "/api/labor-catalog", {
      actor: "manager",
      body: { code: `  ${code}  `, label: "  TEST vidange  ", standardHours: "2.5" },
    });
    expect(res.status).toBe(201);
    entryIds.push(res.body.id);
    const [row] = await db.select().from(laborCatalog).where(eq(laborCatalog.id, res.body.id));
    expect(row).toMatchObject({ code: code.toUpperCase(), label: "TEST vidange", isActive: true });
    expect(Number(row.standardHours)).toBe(2.5);
    expect(row.createdBy).toBe(session.userId("manager"));
    expect(row.updatedBy).toBe(session.userId("manager"));

    const list = await session.call("GET", "/api/labor-catalog", { actor: "technician" });
    const listed = list.body.find((entry: any) => entry.id === res.body.id);
    expect(listed).toMatchObject({ code: code.toUpperCase(), label: "TEST vidange", standardHours: 2.5, isActive: true });
  });

  it("refuse en 400 un code ou un libellé manquant, et un code déjà pris (casse ignorée)", async () => {
    expect((await session.call("POST", "/api/labor-catalog", { actor: "manager", body: { label: "TEST sans code" } })).status).toBe(400);
    expect((await session.call("POST", "/api/labor-catalog", { actor: "manager", body: { code: "   ", label: "TEST" } })).status).toBe(400);
    expect((await session.call("POST", "/api/labor-catalog", { actor: "manager", body: { code: uniqueTestToken("cat") } })).status).toBe(400);
    expect((await session.call("POST", "/api/labor-catalog", { actor: "manager", body: {} })).status).toBe(400);

    const { code } = await createEntry();
    const duplicate = await session.call("POST", "/api/labor-catalog", { actor: "manager", body: { code: code.toUpperCase(), label: "TEST doublon" } });
    expect(duplicate.status).toBe(400);
    expect(await db.select({ id: laborCatalog.id }).from(laborCatalog).where(eq(laborCatalog.code, code.toUpperCase()))).toHaveLength(1);
  });

  it("un poste désactivé sort de la liste par défaut, reste lisible avec includeInactive=1 et ne s'ajoute plus à un OT", async () => {
    const { res } = await createEntry();
    await db.update(laborCatalog).set({ isActive: false }).where(eq(laborCatalog.id, res.body.id));

    const active = await session.call("GET", "/api/labor-catalog", { actor: "technician" });
    expect(active.body.map((e: any) => e.id)).not.toContain(res.body.id);
    const all = await session.call("GET", "/api/labor-catalog?includeInactive=1", { actor: "technician" });
    expect(all.body.find((e: any) => e.id === res.body.id)?.isActive).toBe(false);

    const vehicle = await createTestVehicle();
    session.ids.vehicleIds.push(vehicle.id);
    const [wo] = await db.insert(workOrders).values({ vehicleId: vehicle.id, title: "TEST OT catalogue", status: "in_progress" }).returning();
    workOrderIds.push(wo.id);
    const refused = await session.call("POST", `/api/work-orders/${wo.id}/items`, { actor: "manager", body: { laborCatalogId: res.body.id } });
    expect(refused.status).toBe(400);
  });

  it("deux créations simultanées du même code : une seule réussit, l'autre est refusée proprement", async () => {
    const code = uniqueTestToken("cat").toLowerCase();
    const results = await Promise.all(
      [1, 2].map(() => session.call("POST", "/api/labor-catalog", { actor: "manager", body: { code, label: "TEST concurrence" } })),
    );
    for (const r of results) if (r.status === 201) entryIds.push(r.body.id);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 400]);
  });

  // Manque : le catalogue n'expose ni modification ni désactivation
  // (server/api/work-order-items.routes.ts : `laborCatalogWriteRoutes` ne porte
  // que POST /). Un poste créé par erreur ne peut être ni corrigé ni retiré
  // sans accès à la base.
  describe("poste à désactiver", () => {
    let entryToPatchId = 0;
    // Mise en place hors du `it.fails` : une erreur de création fait échouer le
    // hook au lieu de rendre le cas vert.
    beforeAll(async () => {
      const { res } = await createEntry();
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      entryToPatchId = res.body.id;
    }, 60000);

    it.fails("désactive un poste par PATCH /api/labor-catalog/:id", async () => {
      const patched = await session.call("PATCH", `/api/labor-catalog/${entryToPatchId}`, { actor: "manager", body: { isActive: false } });
      expect(patched.status).toBe(200);
      const [row] = await db.select().from(laborCatalog).where(eq(laborCatalog.id, entryToPatchId));
      expect(row.isActive).toBe(false);
    });
  });
});
