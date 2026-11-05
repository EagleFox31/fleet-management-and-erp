import { messageText } from "../support/api-error";
import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { activityLogs, tires, vehicleTires } from "../../shared/schema";
import { getDefaultTireFormValues } from "../../shared/tire-form";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C — pneus : stock usagé séparé du neuf (docs/plans/pneus-stock-usage.md).
 * - Un pneu démonté vers le stock a roulé : il revient en usagé, jamais en neuf.
 * - Le montage prend du neuf par défaut ; l'usagé se choisit explicitement (`stockSource`).
 * - L'usagé n'est pas valorisé et ne compte pas dans le stock bas (seuil sur le neuf).
 */

type Actor = "warehouse" | "workshopManager" | "technician";
const ACTORS: Record<Actor, TestUserRole> = {
  warehouse: "warehouse",
  workshopManager: "workshop_manager",
  technician: "technician",
};

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<Actor, string>();
const tireIds: number[] = [];

async function call(method: string, path: string, options: { body?: unknown; actor?: Actor } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.actor ? { Cookie: cookies.get(options.actor)! } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function seedTire(stock: { neuf: number; usage?: number; min?: number; price?: string }): Promise<number> {
  const [row] = await db
    .insert(tires)
    .values({
      brand: "TEST-MARQUE",
      model: uniqueTestToken("tire"),
      size: "315/80R22.5",
      stockQuantity: stock.neuf,
      usedStockQuantity: stock.usage ?? 0,
      minStockLevel: stock.min ?? 0,
      purchasePrice: stock.price ?? "100000",
    } as typeof tires.$inferInsert)
    .returning();
  tireIds.push(row.id);
  return row.id;
}

async function tireRow(id: number) {
  const [row] = await db.select().from(tires).where(eq(tires.id, id));
  return row as typeof row & { usedStockQuantity: number };
}

async function seedVehicle(): Promise<number> {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  return vehicle.id;
}

const mountBody = (tireId: number, extra: Record<string, unknown> = {}, position = "front_left") => ({
  tireId,
  position,
  installationDate: "2026-11-01",
  installationMileage: 1000,
  ...extra,
});

async function mount(tireId: number, extra: Record<string, unknown> = {}, position?: string) {
  const vehicleId = await seedVehicle();
  return call("POST", `/api/vehicles/${vehicleId}/tires`, { actor: "workshopManager", body: mountBody(tireId, extra, position) });
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  for (const [actor, role] of Object.entries(ACTORS) as [Actor, TestUserRole][]) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
    });
    expect(res.status).toBe(200);
    cookies.set(actor, res.headers.get("set-cookie")!.split(";")[0]);
  }
}, 60000);

afterAll(async () => {
  if (ids.vehicleIds.length > 0) {
    await db.delete(vehicleTires).where(inArray(vehicleTires.vehicleId, ids.vehicleIds));
  }
  if (tireIds.length > 0) {
    await db.delete(vehicleTires).where(inArray(vehicleTires.tireId, tireIds));
    await db.delete(tires).where(inArray(tires.id, tireIds));
  }
  if (ids.userIds.length > 0) {
    await db.delete(activityLogs).where(inArray(activityLogs.userId, ids.userIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("TIR7 démontage, le pneu qui a roulé revient en usagé", { timeout: 120000 }, () => {
  it("vers le stock : usagé +1, neuf inchangé ; au rebut : aucun des deux ne bouge", async () => {
    const tireId = await seedTire({ neuf: 3 });
    const toStock = await mount(tireId);
    const toScrap = await mount(tireId, {}, "front_right");
    expect(toStock.status).toBe(201);
    expect(toScrap.status).toBe(201);
    expect(await tireRow(tireId)).toMatchObject({ stockQuantity: 1, usedStockQuantity: 0 });

    const back = await call("PATCH", `/api/vehicle-tires/${toStock.body.id}/remove`, {
      actor: "workshopManager",
      body: { destination: "stock", removalMileage: 5000 },
    });
    expect(back.status).toBe(200);
    expect(await tireRow(tireId)).toMatchObject({ stockQuantity: 1, usedStockQuantity: 1 });

    const scrap = await call("PATCH", `/api/vehicle-tires/${toScrap.body.id}/remove`, {
      actor: "workshopManager",
      body: { destination: "scrap", scrapReason: "worn", removalMileage: 5000 },
    });
    expect(scrap.status).toBe(200);
    expect(await tireRow(tireId)).toMatchObject({ stockQuantity: 1, usedStockQuantity: 1 });
  });
});

describe("TIR7 montage, neuf par défaut, usagé sur choix explicite", { timeout: 120000 }, () => {
  it("sans source : prend du neuf et l'enregistre (`stock_source = new`)", async () => {
    const tireId = await seedTire({ neuf: 2, usage: 1 });
    const res = await mount(tireId);
    expect(res.status).toBe(201);
    expect(res.body.stockSource).toBe("new");
    expect(await tireRow(tireId)).toMatchObject({ stockQuantity: 1, usedStockQuantity: 1 });
  });

  it("source usagé : usagé -1, neuf inchangé", async () => {
    const tireId = await seedTire({ neuf: 2, usage: 1 });
    const res = await mount(tireId, { stockSource: "used" });
    expect(res.status).toBe(201);
    expect(res.body.stockSource).toBe("used");
    expect(await tireRow(tireId)).toMatchObject({ stockQuantity: 2, usedStockQuantity: 0 });
  });

  it("usagé à 0 : 409, rien ne bouge", async () => {
    const tireId = await seedTire({ neuf: 2, usage: 0 });
    const res = await mount(tireId, { stockSource: "used" });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/usagé/i);
    expect(await tireRow(tireId)).toMatchObject({ stockQuantity: 2, usedStockQuantity: 0 });
  });

  it("neuf à 0 avec de l'usagé, sans source : 409 lisible qui propose l'usagé, jamais d'usagé implicite", async () => {
    const tireId = await seedTire({ neuf: 0, usage: 2 });
    const res = await mount(tireId);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/2 usagé/);
    expect(messageText(res.body)).not.toMatch(/error|stack|SQL/i);
    expect(await tireRow(tireId)).toMatchObject({ stockQuantity: 0, usedStockQuantity: 2 });
  });

  it("deux montages usagés concurrents sur un seul usagé : un 201, un 409", async () => {
    const tireId = await seedTire({ neuf: 0, usage: 1 });
    const [a, b] = await Promise.all([mount(tireId, { stockSource: "used" }), mount(tireId, { stockSource: "used" })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await tireRow(tireId)).toMatchObject({ stockQuantity: 0, usedStockQuantity: 0 });
  });

  it("source inconnue : 400", async () => {
    const tireId = await seedTire({ neuf: 1 });
    const res = await mount(tireId, { stockSource: "rechape" });
    expect(res.status).toBe(400);
    expect((await tireRow(tireId)).stockQuantity).toBe(1);
  });
});

describe("TIR7 statistiques et stock bas sur le neuf", { timeout: 120000 }, () => {
  it("valeur sans l'usagé, quantité usagée exposée, stock bas calculé sur le neuf", async () => {
    const before = await call("GET", "/api/tires/statistics", { actor: "warehouse" });
    expect(before.status).toBe(200);

    // 1 neuf à 100 000 + 5 usagés : seul le neuf est valorisé ; seuil 2 → stock bas malgré l'usagé.
    const lowId = await seedTire({ neuf: 1, usage: 5, min: 2, price: "100000" });
    const after = await call("GET", "/api/tires/statistics", { actor: "warehouse" });
    expect(after.body.totalValue - before.body.totalValue).toBe(100000);
    expect(after.body.totalStock - before.body.totalStock).toBe(1);
    expect(after.body.usedQuantity - before.body.usedQuantity).toBe(5);

    const low = await call("GET", "/api/tires/low-stock", { actor: "warehouse" });
    expect(low.status).toBe(200);
    expect(low.body.map((t: { id: number }) => t.id)).toContain(lowId);
  });
});

describe("TIR7 fiche, le compteur usagé ne se crée pas, se corrige au magasin", { timeout: 120000 }, () => {
  it("création : usagé forcé à 0 même si le corps en annonce", async () => {
    const res = await call("POST", "/api/tires", {
      actor: "warehouse",
      body: {
        ...getDefaultTireFormValues(),
        brand: "TEST-MARQUE",
        model: uniqueTestToken("tire"),
        manufacturingWeek: "10",
        stockQuantity: 2,
        usedStockQuantity: 7,
        purchasePrice: 250000,
        supplier: "TEST fournisseur",
        location: "TEST rayon",
      },
    });
    expect(res.status).toBe(201);
    tireIds.push(res.body.id);
    expect(await tireRow(res.body.id)).toMatchObject({ stockQuantity: 2, usedStockQuantity: 0 });
  });

  it("modification : le magasinier corrige l'usagé, le technicien est refusé, négatif refusé", async () => {
    const tireId = await seedTire({ neuf: 1 });
    const tech = await call("PATCH", `/api/tires/${tireId}`, { actor: "technician", body: { usedStockQuantity: 3 } });
    expect(tech.status).toBe(403);

    const negative = await call("PATCH", `/api/tires/${tireId}`, { actor: "warehouse", body: { usedStockQuantity: -1 } });
    expect(negative.status).toBe(400);

    const ok = await call("PATCH", `/api/tires/${tireId}`, { actor: "warehouse", body: { usedStockQuantity: 3 } });
    expect(ok.status).toBe(200);
    expect(await tireRow(tireId)).toMatchObject({ stockQuantity: 1, usedStockQuantity: 3 });
  });
});
