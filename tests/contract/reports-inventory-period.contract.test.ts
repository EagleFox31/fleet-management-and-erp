import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { partsStockMovements } from "../../shared/schema";
import { createTestPart } from "../support/factories";
import { startContractSession } from "../support/contract-session";

/**
 * DIR2 : rapport inventaire (`GET /api/reports/inventory`) filtre par periode.
 *
 * Fenetre propre au test (mai 2019) : aucune autre donnee ne s'y trouve, les
 * mouvements comptes sont ceux crees ici, reperes par la piece au jeton unique.
 * Les bornes sont inclusives (`>= start`, `<= end`), les quantites sortantes
 * comptent en valeur absolue dans `movementsCount`.
 */
type Actor = "admin" | "warehouse" | "client" | "driver";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
let partId = 0;
const movementIds: number[] = [];

const START = "2019-05-10T00:00:00.000Z";
const END = "2019-05-20T00:00:00.000Z";
const q = (start: string, end: string) => `/api/reports/inventory?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;

async function movement(createdAt: string, movementType: "in" | "out", quantity: number) {
  const [row] = await db
    .insert(partsStockMovements)
    .values({ partId, movementType, quantity, previousStock: 10, newStock: 10, reason: "DIR2", createdAt: new Date(createdAt) })
    .returning();
  movementIds.push(row.id);
}

function mine(body: any) {
  return (body.parts as any[]).find((p) => p.id === partId);
}

beforeAll(async () => {
  session = await startContractSession<Actor>({ admin: "admin", warehouse: "warehouse", client: "client", driver: "driver" });
  const part = await createTestPart({ quantity: 3, minQuantity: 5, unitPrice: "250.00" });
  partId = part.id;
  session.ids.partIds.push(partId);
  await movement("2019-05-01T12:00:00.000Z", "in", 100); // avant la fenetre
  await movement(START, "in", 4); // borne basse (incluse)
  await movement("2019-05-15T08:30:00.000Z", "out", -2); // sortie : valeur absolue
  await movement(END, "in", 1); // borne haute (incluse)
  await movement("2019-05-20T00:00:00.001Z", "in", 50); // 1 ms apres la fenetre
}, 60000);

afterAll(async () => {
  if (movementIds.length > 0) await db.delete(partsStockMovements).where(inArray(partsStockMovements.id, movementIds));
  await session.stop();
});

describe("DIR2 : rapport inventaire par periode", { timeout: 60000 }, () => {
  it("ne garde que les mouvements de la fenetre, bornes incluses, quantites en valeur absolue", async () => {
    const res = await session.call("GET", q(START, END), { actor: "admin" });
    expect(res.status).toBe(200);
    const own = (res.body.movements as any[]).filter((m) => m.partId === partId);
    expect(own).toHaveLength(3);
    expect(mine(res.body).movementsCount).toBe(4 + 2 + 1);
    expect(mine(res.body).movements).toHaveLength(3);
  });

  it("les statistiques sont coherentes avec les lignes renvoyees", async () => {
    const res = await session.call("GET", q(START, END), { actor: "admin" });
    const { parts, movements, statistics } = res.body;
    expect(statistics.totalParts).toBe(parts.length);
    expect(statistics.totalMovements).toBe(movements.length);
    expect(statistics.totalValue).toBeCloseTo(parts.reduce((s: number, p: any) => s + p.quantity * Number(p.unitPrice), 0), 2);
    expect(statistics.lowStockCount).toBe(parts.filter((p: any) => p.quantity <= p.minQuantity).length);
    // notre piece : 3 <= 5, donc comptee en stock bas
    expect(statistics.lowStockCount).toBeGreaterThanOrEqual(1);
  });

  it("periode sans mouvement : liste vide pour la piece, la piece reste listee", async () => {
    const res = await session.call("GET", q("2019-01-01T00:00:00.000Z", "2019-01-02T00:00:00.000Z"), { actor: "admin" });
    expect(res.status).toBe(200);
    expect(res.body.movements).toHaveLength(0);
    expect(res.body.statistics.totalMovements).toBe(0);
    expect(mine(res.body).movementsCount).toBe(0);
  });

  it("debut apres la fin : aucun mouvement, pas d'erreur", async () => {
    const res = await session.call("GET", q(END, START), { actor: "admin" });
    expect(res.status).toBe(200);
    expect(res.body.movements).toHaveLength(0);
  });

  it("le magasinier lit le rapport, sans session : 401", async () => {
    expect((await session.call("GET", q(START, END), { actor: "warehouse" })).status).toBe(200);
    expect((await session.call("GET", q(START, END), { actor: null })).status).toBe(401);
  });

  it("un client est refuse (403) sur le rapport inventaire", async () => {
    const res = await session.call("GET", q(START, END), { actor: "client" });
    expect(res.status).toBe(403);
  });

  it("un chauffeur est refuse (403) sur le rapport inventaire", async () => {
    const res = await session.call("GET", q(START, END), { actor: "driver" });
    expect(res.status).toBe(403);
  });

  it("une date invalide renvoie 400", async () => {
    const res = await session.call("GET", q("pas-une-date", END), { actor: "admin" });
    expect(res.status).toBe(400);
  });
});
