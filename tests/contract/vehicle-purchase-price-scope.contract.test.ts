import { inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions, vehicles } from "../../shared/schema";
import { ALL_APP_ROLES, VEHICLE_PURCHASE_PRICE_READ_ROLES, type AppRole } from "../../shared/constants/roles";
import { startContractSession } from "../support/contract-session";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Prix d'achat d'un véhicule (`vehicles.purchasePrice`), décision du 3 novembre 2026 :
 * lisible par admin, logistics et secretary ; tout autre rôle de `users.role.enumValues`
 * (chauffeur, client, chef d'atelier, technicien, magasinier, direction, utilisateur) ne le
 * reçoit ni en liste, ni en détail, ni en jointure imbriquée, ni en trame temps réel.
 */
const PRICE = "15000000.00";
const PRICE_DIGITS = "15000000";
const ALLOWED: readonly string[] = VEHICLE_PURCHASE_PRICE_READ_ROLES;
const ROLES = [...ALL_APP_ROLES] as AppRole[];
const DENIED = ROLES.filter((role) => !ALLOWED.includes(role));
// Le chauffeur n'est pas du personnel de plein droit ici : la jointure de mission le concerne s'il est affecté.
const OPERATIONS_ROLES = ROLES.filter((role) => role !== "client");

type Actor = AppRole;
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
let vehicleId = 0;
let plate = "";
let driverId = 0;
let missionId = 0;
const sent: Array<{ type: string; data: any }> = [];

beforeAll(async () => {
  session = await startContractSession<Actor>(Object.fromEntries(ROLES.map((role) => [role, role])) as Record<Actor, AppRole>);
  const vehicle = await createTestVehicle({ ownerId: session.userId("client") });
  vehicleId = vehicle.id;
  plate = vehicle.registrationNumber;
  await db.update(vehicles).set({ purchasePrice: PRICE }).where(inArray(vehicles.id, [vehicleId]));
  const [driver] = await db
    .insert(drivers)
    .values({ firstName: "Test", lastName: uniqueTestToken("chauffeur"), userId: session.userId("driver") })
    .returning();
  driverId = driver.id;
  const [mission] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("mission"), pickupAddress: "A", deliveryAddress: "B", status: "assigned" } as any)
    .returning();
  missionId = mission.id;
  await db.insert(assignments).values({ missionId, vehicleId, driverId, status: "accepted" });
  (global as any).broadcastUpdate = (type: string, data: unknown) => sent.push({ type, data });
}, 90000);

afterAll(async () => {
  delete (global as any).broadcastUpdate;
  await db.delete(assignments).where(inArray(assignments.missionId, [missionId]));
  await db.delete(missions).where(inArray(missions.id, [missionId]));
  await db.delete(drivers).where(inArray(drivers.id, [driverId]));
  await db.delete(vehicles).where(inArray(vehicles.id, [vehicleId]));
  await session.stop();
});

/** Valeur lue : nombre pour un lecteur autorisé, sinon `null` ou absente. */
const priceOf = (row: any) => (row?.purchasePrice === undefined ? undefined : row.purchasePrice);
const leaks = (body: unknown) => JSON.stringify(body).includes(PRICE_DIGITS);

describe("GET /api/vehicles (liste)", () => {
  it.each(ROLES)("%s", async (role) => {
    const res = await session.call("GET", `/api/vehicles?search=${encodeURIComponent(plate)}`, { actor: role });
    expect(res.status).toBe(200);
    const row = res.body.vehicles.find((v: any) => v.id === vehicleId);
    expect(row).toBeDefined();
    if (ALLOWED.includes(role)) expect(Number(row.purchasePrice)).toBe(Number(PRICE));
    else {
      expect(priceOf(row) ?? null).toBeNull();
      expect(leaks(res.body)).toBe(false);
    }
  });
});

describe("GET /api/vehicles/:id (détail)", () => {
  it.each(ROLES)("%s", async (role) => {
    const res = await session.call("GET", `/api/vehicles/${vehicleId}`, { actor: role });
    expect(res.status).toBe(200);
    if (ALLOWED.includes(role)) expect(Number(res.body.purchasePrice)).toBe(Number(PRICE));
    else {
      expect(priceOf(res.body) ?? null).toBeNull();
      expect(leaks(res.body)).toBe(false);
    }
  });
});

describe("GET /api/vehicles/all", () => {
  it.each(ROLES)("%s", async (role) => {
    const res = await session.call("GET", "/api/vehicles/all", { actor: role });
    expect(res.status).toBe(200);
    const row = res.body.find((v: any) => v.id === vehicleId);
    expect(row).toBeDefined();
    if (ALLOWED.includes(role)) expect(Number(row.purchasePrice)).toBe(Number(PRICE));
    else expect(priceOf(row) ?? null).toBeNull();
  });
});

describe("GET /api/operations/missions (jointure mission, affectation, véhicule)", () => {
  it.each(OPERATIONS_ROLES)("%s", async (role) => {
    const res = await session.call("GET", "/api/operations/missions", { actor: role });
    expect(res.status).toBe(200);
    const mission = res.body.find((m: any) => m.id === missionId);
    expect(mission, "la mission de test doit figurer dans la réponse").toBeDefined();
    expect(mission.vehicle.id).toBe(vehicleId);
    if (ALLOWED.includes(role)) expect(Number(mission.vehicle.purchasePrice)).toBe(Number(PRICE));
    else {
      expect(mission.vehicle.purchasePrice).toBeNull();
      expect(leaks(res.body)).toBe(false);
    }
  });
});

describe("GET /api/exports/vehicles (colonne du classeur)", () => {
  it.each(ROLES)("%s", async (role) => {
    const res = await session.raw("GET", "/api/exports/vehicles", role);
    // L'export est déjà limité par la matrice d'exports : les rôles refusés n'ont pas de classeur.
    if (res.status === 403 && !ALLOWED.includes(role)) return;
    expect(res.status).toBe(200);
    const book = XLSX.read(Buffer.from(await res.arrayBuffer()));
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[book.SheetNames[0]]);
    const row = rows.find((r) => r["Immatriculation"] === plate);
    expect(row).toBeDefined();
    if (ALLOWED.includes(role)) expect(Number(row!["Prix d'achat (XAF)"])).toBe(Number(PRICE));
    else expect(Object.keys(row!)).not.toContain("Prix d'achat (XAF)");
  });
});

describe("trame temps réel vehicle_mileage_updated", () => {
  it("la fiche complète ne part qu'aux rôles autorisés, les autres rôles reçoivent la fiche expurgée", async () => {
    sent.length = 0;
    const res = await session.call("PUT", `/api/vehicles/${vehicleId}/mileage`, { actor: "admin", body: { kilometers: 123456 } });
    expect(res.status).toBe(200);
    expect(Number(res.body.purchasePrice)).toBe(Number(PRICE));
    const frames = sent.filter((f) => f.type === "vehicle_mileage_updated");
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      const roles: string[] = frame.data.scope?.roles ?? [];
      const price = frame.data.payload?.vehicle?.purchasePrice;
      if (roles.length > 0 && roles.every((r) => ALLOWED.includes(r))) continue;
      expect(price ?? null, `trame vers ${JSON.stringify(frame.data.scope)}`).toBeNull();
      expect(leaks(frame.data)).toBe(false);
    }
    const toAllowed = frames.filter((f) => (f.data.scope?.roles ?? []).some((r: string) => ALLOWED.includes(r)));
    expect(toAllowed.length).toBeGreaterThan(0);
    expect(Number(toAllowed[0].data.payload.vehicle.purchasePrice)).toBe(Number(PRICE));
    // Aucune trame ne vise tous les rôles ni un rôle refusé avec la valeur.
    expect(frames.some((f) => (f.data.scope?.roles ?? []).some((r: string) => DENIED.includes(r)) && leaks(f.data))).toBe(false);
  });
});

