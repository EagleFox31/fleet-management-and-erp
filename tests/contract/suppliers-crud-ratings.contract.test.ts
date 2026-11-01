import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { alerts, purchaseOrderLines, purchaseOrders, suppliers } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestSupplier } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, SUP1 et SUP2 : fournisseurs.
 * SUP1 : CRUD, désactivation (absent des choix `?isActive=true`), réactivation, rôle refusé, corps invalide.
 * SUP2 : évaluation par critère et par catégorie selon le rôle (shared/constants/supplier-ratings.ts,
 *        supplier-categories.ts).
 */

const ACTORS = {
  admin: "admin",
  secretary: "secretary",
  logistics: "logistics",
  warehouse: "warehouse",
  workshopManager: "workshop_manager",
  technician: "technician",
} as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const orderIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);

async function seed(category: string | null = "Pièces", extra: Partial<typeof suppliers.$inferInsert> = {}) {
  const row = await createTestSupplier({ category: category as string, ...extra });
  ids.supplierIds.push(row.id);
  return row;
}

async function row(id: number) {
  const [r] = await db.select().from(suppliers).where(eq(suppliers.id, id));
  return r;
}

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  // La création par le magasinier émet une alerte « fiche à compléter » en tâche de fond.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (orderIds.length > 0) {
    await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, orderIds));
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, orderIds));
  }
  if (ids.supplierIds.length > 0) {
    await db.delete(alerts).where(inArray(alerts.link, ids.supplierIds.map((id) => `/procurement/suppliers/${id}/edit`)));
  }
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("SUP1 : création et lecture", { timeout: 180000 }, () => {
  it("admin crée un fournisseur complet, il apparaît dans la liste et le détail", async () => {
    const name = uniqueTestToken("supplier-crud");
    const created = await call("POST", "/api/suppliers", {
      actor: "admin",
      body: { name, category: "Pièces", contactName: "TEST contact", email: "test@fournisseur.test", phone: "+237600000001" },
    });
    expect(created.status).toBe(201);
    ids.supplierIds.push(created.body.id);
    expect(created.body.isActive).toBe(true);
    const list = await call("GET", "/api/suppliers?isActive=true", { actor: "logistics" });
    expect(list.status).toBe(200);
    expect(list.body.some((s: any) => (s.supplier ?? s).id === created.body.id)).toBe(true);
    const detail = await call("GET", `/api/suppliers/${created.body.id}`, { actor: "secretary" });
    expect(detail.status).toBe(200);
  });

  it("le magasinier ne renseigne que le nom : le reste du corps est ignoré", async () => {
    const created = await call("POST", "/api/suppliers", {
      actor: "warehouse",
      body: { name: uniqueTestToken("supplier-wh"), category: "Assurance", paymentTerms: 99, qualityRating: 5 },
    });
    expect(created.status).toBe(201);
    ids.supplierIds.push(created.body.id);
    const saved = await row(created.body.id);
    expect(saved.category).toBeNull();
    expect(saved.qualityRating ?? 0).not.toBe(5);
  });

  it("technician : tout /api/suppliers est refusé (403)", async () => {
    expect((await call("POST", "/api/suppliers", { actor: "technician", body: { name: uniqueTestToken("supplier-no") } })).status).toBe(403);
    expect((await call("GET", "/api/suppliers", { actor: "technician" })).status).toBe(403);
  });

  // Décision : le chef d'atelier consulte les fournisseurs (lecture seule), il n'écrit rien.
  it("workshopManager : lecture seule, GET 200 ; création, modification, notation, désactivation 403", async () => {
    const s = await seed("Pièces");
    expect((await call("GET", "/api/suppliers", { actor: "workshopManager" })).status).toBe(200);
    expect((await call("GET", `/api/suppliers/${s.id}`, { actor: "workshopManager" })).status).toBe(200);
    expect((await call("POST", "/api/suppliers", { actor: "workshopManager", body: { name: uniqueTestToken("supplier-no") } })).status).toBe(403);
    expect((await call("PATCH", `/api/suppliers/${s.id}`, { actor: "workshopManager", body: { phone: "0" } })).status).toBe(403);
    expect((await call("PATCH", `/api/suppliers/${s.id}/rating`, { actor: "workshopManager", body: { qualityRating: 4 } })).status).toBe(403);
    expect((await call("DELETE", `/api/suppliers/${s.id}`, { actor: "workshopManager" })).status).toBe(403);
    const saved = await row(s.id);
    expect(saved.isActive).toBe(true);
    expect(saved.phone).not.toBe("0");
    expect(Number(saved.qualityRating ?? 0)).not.toBe(4);
  });

  it("corps vide ou mal typé : 400, jamais 500", async () => {
    const empty = await call("POST", "/api/suppliers", { actor: "admin", body: {} });
    expect(empty.status).toBe(400);
    const wrong = await call("POST", "/api/suppliers", { actor: "admin", body: { name: 5 } });
    expect(wrong.status).toBe(400);
  });

  it("nom déjà pris : 409 lisible, pas une 500", async () => {
    const existing = await seed();
    const res = await call("POST", "/api/suppliers", { actor: "admin", body: { name: existing.name, category: "Pièces" } });
    expect(res.status).toBe(409);
  });

  it("id inconnu : 404 ; id non numérique : 400", async () => {
    expect((await call("GET", "/api/suppliers/2147483000", { actor: "admin" })).status).toBe(404);
    expect((await call("GET", "/api/suppliers/abc", { actor: "admin" })).status).toBe(400);
  });
});

describe("SUP1 : modification et désactivation", { timeout: 180000 }, () => {
  it("PATCH modifie un champ (secrétaire) ; magasinier refusé", async () => {
    const s = await seed();
    const ok = await call("PATCH", `/api/suppliers/${s.id}`, { actor: "secretary", body: { phone: "+237611111111" } });
    expect(ok.status).toBe(200);
    expect((await row(s.id)).phone).toBe("+237611111111");
    expect((await call("PATCH", `/api/suppliers/${s.id}`, { actor: "warehouse", body: { phone: "0" } })).status).toBe(403);
    expect((await row(s.id)).phone).toBe("+237611111111");
  });

  it("PATCH : corps mal typé 400, id inconnu 404", async () => {
    const s = await seed();
    expect((await call("PATCH", `/api/suppliers/${s.id}`, { actor: "admin", body: { name: 5 } })).status).toBe(400);
    expect((await call("PATCH", "/api/suppliers/2147483000", { actor: "admin", body: { phone: "1" } })).status).toBe(404);
  });

  it("un fournisseur désactivé disparaît des choix, revient à la réactivation ; rejouable", async () => {
    const s = await seed();
    const inChoices = async () =>
      (await call("GET", "/api/suppliers?isActive=true", { actor: "warehouse" })).body.some((x: any) => (x.supplier ?? x).id === s.id);
    expect(await inChoices()).toBe(true);

    const off = await call("DELETE", `/api/suppliers/${s.id}`, { actor: "logistics" });
    expect(off.status).toBe(200);
    expect((await row(s.id)).isActive).toBe(false);
    expect(await inChoices()).toBe(false);
    // Toujours consultable (historique) et dans la liste complète.
    expect((await call("GET", `/api/suppliers/${s.id}`, { actor: "admin" })).status).toBe(200);
    const inactive = await call("GET", "/api/suppliers?isActive=false", { actor: "admin" });
    expect(inactive.body.some((x: any) => (x.supplier ?? x).id === s.id)).toBe(true);

    expect((await call("DELETE", `/api/suppliers/${s.id}`, { actor: "logistics" })).status).toBe(200);
    expect((await row(s.id)).isActive).toBe(false);

    expect((await call("PATCH", `/api/suppliers/${s.id}/reactivate`, { actor: "secretary" })).status).toBe(200);
    expect(await inChoices()).toBe(true);
  });

  it("désactivation et réactivation refusées au magasinier ; id inconnu : 404", async () => {
    const s = await seed();
    expect((await call("DELETE", `/api/suppliers/${s.id}`, { actor: "warehouse" })).status).toBe(403);
    expect((await call("PATCH", `/api/suppliers/${s.id}/reactivate`, { actor: "warehouse" })).status).toBe(403);
    expect((await call("DELETE", "/api/suppliers/2147483000", { actor: "admin" })).status).toBe(404);
    expect((await row(s.id)).isActive).toBe(true);
  });

  it("une nouvelle commande ne peut pas viser un fournisseur désactivé", async () => {
    const s = await seed(undefined, { isActive: false });
    const res = await call("POST", "/api/purchase-orders", {
      actor: "admin",
      body: { supplierId: s.id, manualLines: [{ description: "TEST ligne", quantityOrdered: 1, unitPrice: 100 }] },
    });
    if (res.status === 201) orderIds.push(res.body.id);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe("SUP2 : évaluation selon le rôle et la catégorie", { timeout: 180000 }, () => {
  const rate = (actor: Actor, id: number, body: unknown) => call("PATCH", `/api/suppliers/${id}/rating`, { actor, body });

  it("critères par rôle : qualité (atelier, magasin, admin), délais (logistique), prix (secrétariat)", async () => {
    const s = await seed("Pièces");
    expect((await rate("warehouse", s.id, { qualityRating: 4 })).status).toBe(200);
    expect((await rate("warehouse", s.id, { reliabilityRating: 4 })).status).toBe(403);
    expect((await rate("warehouse", s.id, { priceCompetitiveness: 4 })).status).toBe(403);
    expect((await rate("logistics", s.id, { reliabilityRating: 3 })).status).toBe(200);
    expect((await rate("logistics", s.id, { qualityRating: 1 })).status).toBe(403);
    expect((await rate("secretary", s.id, { priceCompetitiveness: 2 })).status).toBe(200);
    expect((await rate("secretary", s.id, { qualityRating: 1 })).status).toBe(403);
    const full = await rate("admin", s.id, { qualityRating: 5, reliabilityRating: 5, priceCompetitiveness: 5 });
    expect(full.status).toBe(200);
    const saved = await row(s.id);
    expect(Number(saved.qualityRating)).toBe(5);
    expect(Number(saved.reliabilityRating)).toBe(5);
    expect(Number(saved.priceCompetitiveness)).toBe(5);
  });

  it("un refus ne modifie aucune note", async () => {
    const s = await seed("Pièces");
    await db.update(suppliers).set({ qualityRating: "3" as any }).where(eq(suppliers.id, s.id));
    const refused = await rate("logistics", s.id, { qualityRating: 1, reliabilityRating: 5 });
    expect(refused.status).toBe(403);
    const saved = await row(s.id);
    expect(Number(saved.qualityRating)).toBe(3);
    expect(Number(saved.reliabilityRating ?? 0)).not.toBe(5);
  });

  it.each([
    ["workshopManager", "Assurance", 403],
    ["workshopManager", "Carburant", 403],
    ["warehouse", "Assurance", 403],
    ["warehouse", "Carburant", 403],
    ["logistics", "Télécom", 403],
    ["logistics", "Assurance", 200],
    ["secretary", "Télécom", 200],
    ["admin", "Télécom", 200],
  ] as const)("%s évalue la catégorie « %s » : %s", async (actor, category, expected) => {
    const s = await seed(category);
    // Le critère testé est autorisé pour le rôle, seule la catégorie varie.
    const field = actor === "logistics" ? { reliabilityRating: 3 } : actor === "secretary" ? { priceCompetitiveness: 3 } : { qualityRating: 3 };
    const res = actor === "workshopManager"
      ? await call("PATCH", `/api/suppliers/${s.id}/rating`, { actor: "workshopManager", body: field })
      : await rate(actor, s.id, field);
    expect(res.status).toBe(expected);
  });

  it("le chef d'atelier n'évalue pas, même une catégorie pièces (403, lecture seule)", async () => {
    const s = await seed("Pièces détachées");
    expect((await rate("workshopManager", s.id, { qualityRating: 4 })).status).toBe(403);
    expect(Number((await row(s.id)).qualityRating ?? 0)).not.toBe(4);
  });

  it("le technicien ne peut rien évaluer (403)", async () => {
    const s = await seed("Pièces");
    expect((await rate("technician", s.id, { qualityRating: 4 })).status).toBe(403);
  });

  it("note hors 0..5, mal typée ou corps vide : 400 ; fournisseur inconnu : 404", async () => {
    const s = await seed("Pièces");
    expect((await rate("admin", s.id, { qualityRating: 6 })).status).toBe(400);
    expect((await rate("admin", s.id, { qualityRating: -1 })).status).toBe(400);
    expect((await rate("admin", s.id, { qualityRating: "bon" })).status).toBe(400);
    expect((await rate("admin", s.id, {})).status).toBe(400);
    expect((await rate("admin", 2147483000, { qualityRating: 3 })).status).toBe(404);
  });

  it("le PATCH de la fiche ne contourne pas les droits de notation", async () => {
    const s = await seed("Pièces");
    await call("PATCH", `/api/suppliers/${s.id}`, { actor: "logistics", body: { qualityRating: 5, priceCompetitiveness: 5 } });
    const saved = await row(s.id);
    expect(Number(saved.qualityRating ?? 0)).not.toBe(5);
    expect(Number(saved.priceCompetitiveness ?? 0)).not.toBe(5);
  });
});
