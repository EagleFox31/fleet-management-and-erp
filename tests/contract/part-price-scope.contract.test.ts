import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { partRequirements, partVariants } from "../../shared/schema";
import { normalizeScope, resolveRecipients } from "../../server/lib/realtime-scope";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart } from "../support/factories";
import { startContractActors } from "../support/contract-actors";
import { uniqueTestToken } from "../support/ids";

/**
 * Prix des pièces (Q23) : le chauffeur lit le catalogue et les demandes de pièce sans aucune clé de
 * prix (`unitPrice`, `additionalPrice`, `partUnitPrice`, `estimatedCost`) et ne reçoit pas la trame de
 * mouvement de stock ; le magasinier et le technicien reçoivent le prix.
 */
const ACTORS = { warehouse: "warehouse", technician: "technician", driver: "driver" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const frames: { eventType: string; scope?: unknown; payload?: unknown }[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let partId = 0;
let reference = "";
let requirementId = 0;

const PRICE_KEY = /"(unitPrice|additionalPrice|partUnitPrice|estimatedCost)"/;
const hasPrice = (value: unknown): boolean => PRICE_KEY.test(JSON.stringify(value));

/** Routes qui portent un prix : le lecteur du stock le reçoit, le chauffeur non. */
const pricedPaths = () => [
  `/api/parts?search=${encodeURIComponent(reference)}&limit=100`,
  `/api/parts/${partId}`,
  "/api/parts/low-on-stock",
  `/api/parts/${partId}/variants`,
  "/api/part-requirements",
  `/api/part-requirements/by-part/${partId}`,
];

/** Témoins : routes sans montant, sous le même masque ; aucune clé de prix pour personne. */
const witnessPaths = () => [`/api/parts/stock-movements?partId=${partId}`, `/api/parts/${partId}/stock-history`];

const reaches = (scope: unknown, actor: Actor): boolean =>
  resolveRecipients(normalizeScope(scope, null), {
    byUser: new Map([[session.userIdOf(actor), new Set(["s"])]]),
    byRole: new Map([[ACTORS[actor], new Set(["s"])]]),
  }).size > 0;

beforeAll(async () => {
  (global as any).broadcastUpdate = (eventType: string, data: any) => {
    frames.push({ eventType, scope: data?.scope, payload: data?.payload });
  };
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  reference = uniqueTestToken("ppr");
  // Stock nul sous le minimum : la pièce figure aussi dans /low-on-stock.
  const part = await createTestPart({ reference, quantity: 0, minQuantity: 5, unitPrice: "4321.00" });
  ids.partIds.push(part.id);
  partId = part.id;
  const variant = await session.call("POST", `/api/parts/${partId}/variants`, {
    actor: "warehouse",
    body: { variantName: "TEST", variantCode: uniqueTestToken("ppv"), additionalPrice: 77 },
  });
  expect(variant.status, JSON.stringify(variant.body)).toBe(201);
  const movement = await session.call("POST", "/api/warehouse/stock-movement", {
    actor: "warehouse",
    body: { partId, type: "in", quantity: 2, reason: "TEST prix" },
  });
  expect(movement.status, JSON.stringify(movement.body)).toBe(201);
  // Demande de pièce : prix unitaire (jointure) et coût estimé (stocké, 2 × 4321) servis par /api/part-requirements.
  const [requirement] = await db
    .insert(partRequirements)
    .values({ partId, quantityNeeded: 2, reason: "TEST prix", status: "pending", estimatedCost: "8642.00", requestedBy: session.userIdOf("technician") })
    .returning();
  requirementId = requirement.id;
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (requirementId) await db.delete(partRequirements).where(inArray(partRequirements.id, [requirementId]));
  if (partId) await db.delete(partVariants).where(inArray(partVariants.partId, [partId]));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("prix des pièces", { timeout: 120000 }, () => {
  it("le magasinier et le technicien reçoivent le prix sur la fiche, la liste, le stock bas, les variantes et les demandes", async () => {
    for (const actor of ["warehouse", "technician"] as const) {
      for (const path of pricedPaths()) {
        const res = await session.call("GET", path, { actor });
        expect(res.status, `${actor} ${path}`).toBe(200);
        expect(hasPrice(res.body), `${actor} ${path}`).toBe(true);
      }
    }
    const detail = await session.call("GET", `/api/parts/${partId}`, { actor: "warehouse" });
    expect(Number(detail.body.unitPrice)).toBe(4321);
    const requirements = await session.call("GET", `/api/part-requirements/by-part/${partId}`, { actor: "warehouse" });
    const mine = requirements.body.find((r: { id: number }) => r.id === requirementId);
    expect(Number(mine.partUnitPrice)).toBe(4321);
    expect(Number(mine.estimatedCost)).toBe(8642);
  });

  it("le chauffeur lit les mêmes routes sans aucune clé de prix", async () => {
    for (const path of [...pricedPaths(), ...witnessPaths()]) {
      const res = await session.call("GET", path, { actor: "driver" });
      expect(res.status, path).toBe(200);
      expect(hasPrice(res.body), path).toBe(false);
    }
    const detail = await session.call("GET", `/api/parts/${partId}`, { actor: "driver" });
    expect(detail.body.reference).toBe(reference);
    expect(detail.body).not.toHaveProperty("unitPrice");
    const list = await session.call("GET", pricedPaths()[0], { actor: "driver" });
    expect(list.body.parts.map((p: { id: number }) => p.id)).toContain(partId);
    const requirements = await session.call("GET", `/api/part-requirements/by-part/${partId}`, { actor: "driver" });
    expect(requirements.body.map((r: { id: number }) => r.id)).toContain(requirementId);
  });

  it("témoins (mouvements, historique) : aucune clé de prix, même pour le magasinier", async () => {
    for (const path of witnessPaths()) {
      const res = await session.call("GET", path, { actor: "warehouse" });
      expect(res.status, path).toBe(200);
      expect(hasPrice(res.body), path).toBe(false);
    }
  });

  it("variantes de chemin (casse, barre finale) : toujours masquées pour le chauffeur", async () => {
    // La barre finale est servie (Express non strict) : au moins un chemin doit répondre 200.
    const trailing = await session.call("GET", `/api/parts/${partId}/`, { actor: "driver" });
    expect(trailing.status).toBe(200);
    expect(trailing.body.reference).toBe(reference);
    expect(hasPrice(trailing.body)).toBe(false);
    // Casse : le routeur des demandes est insensible à la casse, le chemin doit être servi et masqué.
    const upper = await session.call("GET", `/api/PART-REQUIREMENTS/by-part/${partId}`, { actor: "driver" });
    expect(upper.status).toBe(200);
    expect(upper.body.map((r: { id: number }) => r.id)).toContain(requirementId);
    expect(hasPrice(upper.body)).toBe(false);
    for (const path of [`/api/PARTS/${partId}`, `/api/Parts/${partId}/variants`]) {
      const res = await session.call("GET", path, { actor: "driver" });
      if (res.status === 200) expect(hasPrice(res.body), path).toBe(false);
    }
  });

  it("trame de mouvement de stock : magasinier et technicien, pas le chauffeur", () => {
    const frame = frames.find((f) => f.eventType === "warehouse_stock_movement_recorded");
    expect(frame).toBeDefined();
    expect(reaches(frame!.scope, "warehouse")).toBe(true);
    expect(reaches(frame!.scope, "technician")).toBe(true);
    expect(reaches(frame!.scope, "driver")).toBe(false);
  });
});
