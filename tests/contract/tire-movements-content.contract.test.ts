import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tireMovementsResponseSchema, TIRE_MOVEMENTS_PATH, type TireMovement } from "../../shared/contracts/tire-movements";
import { tireInspections, tireRotationDetails, tireRotations, tires, vehicleTires } from "../../shared/schema";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { TEST_PREFIX } from "../support/ids";

/**
 * Niveau C, P-15 : contenu de `GET /api/tires/movements` (droits et schéma déjà dans `aggregate-reads`).
 * Mouvements reconstitués depuis montages, démontages, rotations et inspections : ordre, filtres, champs.
 * Dates en 2001 : aucune autre suite n'y écrit, la fenêtre `from`/`to` isole les lignes du fichier.
 */
const previousFlags = process.env.FEATURE_FLAGS;
process.env.FEATURE_FLAGS = "tire-movements=on";

const READERS = ["admin", "management", "workshop_manager", "warehouse", "technician"] as const;
const OTHERS = ["driver", "client", "secretary", "logistics"] as const;
const YEAR = "from=2001-01-01&to=2001-12-31";

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
const userIds = new Map<string, number>();
const userNames = new Map<string, string>();
const tireIds: number[] = [];
let vehicleA = { id: 0, plate: "" };
let vehicleB = { id: 0, plate: "" };
let tire1 = 0;
let tire2 = 0;

async function login(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  userIds.set(role, user.id);
  userNames.set(role, user.name);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
}

async function get(path: string, role?: string) {
  const res = await fetch(baseUrl + path, { headers: role ? { Cookie: cookies.get(role)! } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function movements(query: string, role = "warehouse"): Promise<TireMovement[]> {
  const res = await get(`${TIRE_MOVEMENTS_PATH}?${query}`, role);
  expect(res.status).toBe(200);
  const parsed = tireMovementsResponseSchema.safeParse(res.body);
  expect(parsed.success).toBe(true);
  return parsed.data!;
}

async function newTire(model: string): Promise<number> {
  const [row] = await db
    .insert(tires)
    .values({ brand: `${TEST_PREFIX}mv`, model, size: "315/80R22.5", createdBy: userIds.get("warehouse")! })
    .returning({ id: tires.id });
  tireIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of [...READERS, ...OTHERS]) await login(role);

  for (const target of ["A", "B"] as const) {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    if (target === "A") vehicleA = { id: v.id, plate: v.registrationNumber };
    else vehicleB = { id: v.id, plate: v.registrationNumber };
  }
  tire1 = await newTire("T1");
  tire2 = await newTire("T2");

  // Pneu 1 sur A : monté, tourné, inspecté, démonté. Pneu 2 sur B : monté, toujours en place.
  const [mount1] = await db
    .insert(vehicleTires)
    .values({
      vehicleId: vehicleA.id, tireId: tire1, position: "front_left",
      installationDate: "2001-03-01", installationMileage: 1000,
      removalDate: "2001-06-01", removalMileage: 5000, status: "removed",
    })
    .returning({ id: vehicleTires.id });
  await db.insert(vehicleTires).values({
    vehicleId: vehicleB.id, tireId: tire2, position: "rear_left_outer",
    installationDate: "2001-02-01", installationMileage: 200,
  });
  const [rotation] = await db
    .insert(tireRotations)
    .values({
      vehicleId: vehicleA.id, rotationDate: "2001-04-01", rotationMileage: 3000,
      rotationType: "cross_rotation", performedBy: userIds.get("workshop_manager")!,
    })
    .returning({ id: tireRotations.id });
  await db.insert(tireRotationDetails).values({
    rotationId: rotation.id, vehicleTireId: mount1.id, fromPosition: "front_left", toPosition: "front_right",
  });
  await db.insert(tireInspections).values({
    vehicleTireId: mount1.id, inspectionDate: "2001-05-01", inspectionMileage: 4000,
    condition: "good", inspectedBy: userIds.get("technician")!,
  });
}, 180000);

afterAll(async () => {
  process.env.FEATURE_FLAGS = previousFlags;
  if (tireIds.length > 0) {
    const mounted = (
      await db.select({ id: vehicleTires.id }).from(vehicleTires).where(inArray(vehicleTires.tireId, tireIds))
    ).map((row) => row.id);
    if (mounted.length > 0) {
      await db.delete(tireInspections).where(inArray(tireInspections.vehicleTireId, mounted));
      await db.delete(tireRotationDetails).where(inArray(tireRotationDetails.vehicleTireId, mounted));
    }
    if (ids.vehicleIds.length > 0) await db.delete(tireRotations).where(inArray(tireRotations.vehicleId, ids.vehicleIds));
    await db.delete(vehicleTires).where(inArray(vehicleTires.tireId, tireIds));
    await db.delete(tires).where(inArray(tires.id, tireIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("mouvements de pneus : contenu", { timeout: 120000 }, () => {
  it("lecture : rôles pneus 200 ; chauffeur, client, secrétariat, logistique 403 ; anonyme 401", async () => {
    expect((await get(`${TIRE_MOVEMENTS_PATH}?${YEAR}`)).status).toBe(401);
    for (const role of READERS) expect((await get(`${TIRE_MOVEMENTS_PATH}?${YEAR}`, role)).status, role).toBe(200);
    for (const role of OTHERS) expect((await get(`${TIRE_MOVEMENTS_PATH}?${YEAR}`, role)).status, role).toBe(403);
  });

  it("historique d'un pneu : quatre mouvements, du plus récent au plus ancien, champs reconstitués", async () => {
    const rows = await movements(`${YEAR}&tireId=${tire1}`);
    expect(rows.map((r) => [r.kind, r.at.slice(0, 10), r.mileage])).toEqual([
      ["removed", "2001-06-01", 5000],
      ["inspected", "2001-05-01", 4000],
      ["rotated", "2001-04-01", 3000],
      ["installed", "2001-03-01", 1000],
    ]);
    for (const r of rows) {
      expect(r.tireId).toBe(tire1);
      expect(r.tireLabel).toBe(`${TEST_PREFIX}mv T1 315/80R22.5`);
      expect(r.vehicleId).toBe(vehicleA.id);
      expect(r.vehicleLabel).toBe(vehicleA.plate);
    }
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
    // Rotation : position d'arrivée et auteur ; montage et démontage : position du montage, sans auteur.
    expect(byKind.rotated.position).toBe("front_right");
    expect(byKind.rotated.byUserName).toBe(userNames.get("workshop_manager"));
    expect(byKind.inspected.byUserName).toBe(userNames.get("technician"));
    expect(byKind.installed.position).toBe("front_left");
    expect(byKind.installed.byUserName).toBeNull();
    expect(byKind.removed.position).toBe("front_left");
  });

  it("pneu encore monté : pas de mouvement de démontage", async () => {
    const rows = await movements(`${YEAR}&tireId=${tire2}`);
    expect(rows.map((r) => r.kind)).toEqual(["installed"]);
    expect(rows[0]).toMatchObject({ vehicleId: vehicleB.id, position: "rear_left_outer", mileage: 200 });
  });

  it("filtre véhicule : seuls les mouvements du véhicule demandé", async () => {
    const onB = await movements(`${YEAR}&vehicleId=${vehicleB.id}`);
    expect(onB.map((r) => [r.kind, r.tireId])).toEqual([["installed", tire2]]);
    const onA = await movements(`${YEAR}&vehicleId=${vehicleA.id}`);
    expect(new Set(onA.map((r) => r.tireId))).toEqual(new Set([tire1]));
    expect(onA).toHaveLength(4);
  });

  it("fenêtre de dates : bornes incluses des deux côtés", async () => {
    const rows = await movements(`from=2001-04-01&to=2001-05-01&tireId=${tire1}`);
    expect(rows.map((r) => r.kind)).toEqual(["inspected", "rotated"]);
    expect(await movements(`from=2001-06-02&to=2001-12-31&tireId=${tire1}`)).toEqual([]);
  });

  it("filtres combinés sans intersection : liste vide, pas d'erreur", async () => {
    expect(await movements(`${YEAR}&tireId=${tire1}&vehicleId=${vehicleB.id}`)).toEqual([]);
  });

  it("période inversée : 400 avec un message lisible", async () => {
    const res = await get(`${TIRE_MOVEMENTS_PATH}?from=2001-12-31&to=2001-01-01`, "warehouse");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/ZodError|stack|SELECT/);
  });

  it("drapeau coupé : 404", async () => {
    process.env.FEATURE_FLAGS = "tire-movements=off";
    try {
      expect((await get(`${TIRE_MOVEMENTS_PATH}?${YEAR}`, "admin")).status).toBe(404);
    } finally {
      process.env.FEATURE_FLAGS = "tire-movements=on";
    }
  });
});
