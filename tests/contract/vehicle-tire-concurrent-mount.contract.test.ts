import { messageText } from "../support/api-error";
import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../server/db";
import { activityLogs, tires, vehicleTires } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C — un pneu actif par position, sous concurrence.
 *
 * installTireOnVehicle contrôle la position par un SELECT, puis décrémente le stock, puis insère. Deux
 * montages simultanés passaient tous les deux le SELECT : deux pneus actifs à la même position. L'index
 * unique partiel uq_vehicle_tires_active_position refuse le second, rendu en 409 comme le contrôle.
 *
 * Course rendue déterministe : une connexion à part verrouille la ligne du pneu. Les deux montages font
 * leur SELECT (position libre), puis attendent sur le décrément. Le verrou n'est relâché qu'une fois les
 * deux requêtes en attente.
 */

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();
const tireIds: number[] = [];

async function mount(vehicleId: number, tireId: number) {
  const response = await fetch(`${baseUrl}/api/vehicles/${vehicleId}/tires`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ tireId, position: "front_left", installationDate: "2026-11-07", installationMileage: 1000 }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/**
 * Attend que `count` requêtes de cette base soient bloquées sur un verrou. Le second montage n'attend pas
 * directement le détenteur mais le premier montage (file d'attente du verrou de ligne) : on compte donc
 * toute requête bloquée, pas seulement celles que bloque le détenteur.
 */
async function waitForBlocked(count: number) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0`,
    );
    if (rows[0].n >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${count} montage(s) attendus en attente du verrou, délai dépassé`);
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const user = await createTestUser({ role: "workshop_manager" });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.get("set-cookie")!.split(";")[0];
}, 60000);

afterAll(async () => {
  if (ids.vehicleIds.length > 0) await db.delete(vehicleTires).where(inArray(vehicleTires.vehicleId, ids.vehicleIds));
  if (tireIds.length > 0) {
    await db.delete(vehicleTires).where(inArray(vehicleTires.tireId, tireIds));
    await db.delete(tires).where(inArray(tires.id, tireIds));
  }
  if (ids.userIds.length > 0) await db.delete(activityLogs).where(inArray(activityLogs.userId, ids.userIds));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("montages concurrents sur la même position", { timeout: 120000 }, () => {
  it("un seul passe, l'autre reçoit 409 et le stock ne bouge qu'une fois", async () => {
    const [tire] = await db
      .insert(tires)
      .values({ brand: "TEST-MARQUE", model: uniqueTestToken("tire"), size: "315/80R22.5", stockQuantity: 5, minStockLevel: 0, purchasePrice: "100000" } as typeof tires.$inferInsert)
      .returning();
    tireIds.push(tire.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);

    const holder = await pool.connect();
    let pending: Promise<Awaited<ReturnType<typeof mount>>>[] = [];
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM tires WHERE id = $1 FOR UPDATE", [tire.id]);
      pending = [mount(vehicle.id, tire.id), mount(vehicle.id, tire.id)];
      await waitForBlocked(2);
      await holder.query("COMMIT");
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      holder.release();
      // Même en échec, les montages se terminent avant le nettoyage.
      await Promise.allSettled(pending);
    }
    const outcomes = await Promise.all(pending);

    expect(outcomes.map((o) => o.status).sort()).toEqual([201, 409]);
    expect(messageText(outcomes.find((o) => o.status === 409)!.body)).toBe("Cette position est déjà occupée sur le véhicule");

    const active = await db.select({ id: vehicleTires.id }).from(vehicleTires).where(eq(vehicleTires.vehicleId, vehicle.id));
    expect(active).toHaveLength(1);
    const [after] = await db.select({ stockQuantity: tires.stockQuantity }).from(tires).where(eq(tires.id, tire.id));
    expect(after.stockQuantity).toBe(4);
  });
});
