import { apiErrorProblems, messageText } from "../support/api-error";
import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../server/db";
import { POSITION_OCCUPIED_MESSAGE } from "../../server/services/tires-service-simplified";
import { activityLogs, tires, vehicleTires } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C — un pneu actif par position, sous concurrence et à la modification.
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

type Outcome = { status: number; body: unknown; requestIdHeader: string | null };

async function call(method: "POST" | "PATCH", path: string, payload: unknown): Promise<Outcome> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(payload),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null),
    requestIdHeader: response.headers.get("x-request-id"),
  };
}

const mount = (vehicleId: number, tireId: number, position = "front_left") =>
  call("POST", `/api/vehicles/${vehicleId}/tires`, { tireId, position, installationDate: "2026-11-07", installationMileage: 1000 });

/** 409 « position occupée » au contrat commun : code, requestId (corps et en-tête), aucun détail technique. */
function expectPositionOccupied(outcome: Outcome) {
  expect(apiErrorProblems(outcome.status, outcome.body, 409, "CONFLICT", outcome.requestIdHeader)).toEqual([]);
  expect(messageText(outcome.body as { message?: unknown })).toBe(POSITION_OCCUPIED_MESSAGE);
  const text = JSON.stringify(outcome.body);
  expect(text).not.toContain("uq_vehicle_tires_active_position");
  expect(text).not.toContain("23505");
}

async function seedTire(stockQuantity: number) {
  const [tire] = await db
    .insert(tires)
    .values({ brand: "TEST-MARQUE", model: uniqueTestToken("tire"), size: "315/80R22.5", stockQuantity, minStockLevel: 0, purchasePrice: "100000" } as typeof tires.$inferInsert)
    .returning();
  tireIds.push(tire.id);
  return tire;
}

/**
 * Attend que `count` requêtes soient en attente derrière le détenteur. Seul l'arbre de verrous du
 * détenteur compte : le second montage attend le premier (file du verrou de ligne), pas le détenteur
 * directement. Les autres requêtes bloquées d'une base partagée sont ignorées.
 */
async function waitForBlocked(holderPid: number, count: number) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { rows } = await pool.query(
      `WITH RECURSIVE waiting(pid) AS (
         SELECT pid FROM pg_stat_activity WHERE $1::int = ANY (pg_blocking_pids(pid))
         UNION
         SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid = ANY (pg_blocking_pids(a.pid))
       )
       SELECT count(*)::int AS n FROM waiting`,
      [holderPid],
    );
    if (rows[0].n >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  // Montage absent de l'arbre : souvent faute de connexion (pool plein, attente de 10 s puis 500 sans écriture).
  throw new Error(
    `${count} montage(s) attendus en attente du verrou, délai dépassé ; pool : ${pool.totalCount} connexion(s), ${pool.idleCount} libre(s), ${pool.waitingCount} en file`,
  );
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

describe("un pneu actif par position", { timeout: 120000 }, () => {
  it("montages concurrents : un seul passe, l'autre reçoit 409 et le stock ne bouge qu'une fois", async () => {
    const tire = await seedTire(5);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);

    const holder = await pool.connect();
    let pending: Promise<Outcome>[] = [];
    try {
      await holder.query("BEGIN");
      const { rows } = await holder.query("SELECT pg_backend_pid() AS pid");
      await holder.query("SELECT id FROM tires WHERE id = $1 FOR UPDATE", [tire.id]);
      pending = [mount(vehicle.id, tire.id), mount(vehicle.id, tire.id)];
      await waitForBlocked(rows[0].pid, 2);
      await holder.query("COMMIT");
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      holder.release();
      // Même en échec, les montages se terminent avant le nettoyage.
      await Promise.allSettled(pending);
    }
    const outcomes = await Promise.all(pending);

    expect(outcomes.map((o) => o.status).sort()).toEqual([201, 409]);
    expectPositionOccupied(outcomes.find((o) => o.status === 409)!);

    const active = await db.select({ id: vehicleTires.id }).from(vehicleTires).where(eq(vehicleTires.vehicleId, vehicle.id));
    expect(active).toHaveLength(1);
    const [after] = await db.select({ stockQuantity: tires.stockQuantity }).from(tires).where(eq(tires.id, tire.id));
    expect(after.stockQuantity).toBe(4);
  });

  it("modification vers une position occupée : même 409, montage inchangé", async () => {
    const tire = await seedTire(5);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    expect((await mount(vehicle.id, tire.id, "front_left")).status).toBe(201);
    const second = await mount(vehicle.id, tire.id, "front_right");
    expect(second.status).toBe(201);
    const secondId = (second.body as { id: number }).id;

    const outcome = await call("PATCH", `/api/vehicle-tires/${secondId}`, { position: "front_left" });
    expectPositionOccupied(outcome);

    const [row] = await db.select({ position: vehicleTires.position }).from(vehicleTires).where(eq(vehicleTires.id, secondId));
    expect(row.position).toBe("front_right");
  });
});
