import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, cloison des lectures de parc (R-03) et de chauffeurs (R-13).
 * Client : ne voit que ses véhicules (liste, /all, check). Chauffeur : ne voit que
 * sa fiche CPC et ses missions. Personnel (admin, workshop_manager) : vue complète.
 */

type Actor = "admin" | "workshop" | "clientA" | "clientB" | "driverA" | "driverB";
const ACTORS: Record<Actor, TestUserRole> = {
  admin: "admin",
  workshop: "workshop_manager",
  clientA: "client",
  clientB: "client",
  driverA: "driver",
  driverB: "driver",
};

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<Actor, string>();
const userIds = new Map<Actor, number>();
const vehicle = {} as Record<"A" | "B" | "none", { id: number; plate: string }>;
const driverRows = {} as Record<"A" | "B", number>;
const missionRows = {} as Record<"A" | "B", number>;

async function get(path: string, actor: Actor) {
  const response = await fetch(baseUrl + path, { headers: { Cookie: cookies.get(actor)! } });
  const text = await response.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // corps non JSON
  }
  return { status: response.status, body };
}

const idsOf = (rows: Array<{ id: number }>) => rows.map((row) => row.id);

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  for (const [actor, role] of Object.entries(ACTORS) as [Actor, TestUserRole][]) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    userIds.set(actor, user.id);
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
    });
    expect(res.status).toBe(200);
    cookies.set(actor, res.headers.get("set-cookie")!.split(";")[0]);
  }

  for (const [key, owner] of [["A", userIds.get("clientA")], ["B", userIds.get("clientB")], ["none", undefined]] as const) {
    const created = await createTestVehicle({ ownerId: owner });
    ids.vehicleIds.push(created.id);
    vehicle[key] = { id: created.id, plate: created.registrationNumber };
  }

  for (const key of ["A", "B"] as const) {
    const [driver] = await db
      .insert(drivers)
      .values({
        userId: userIds.get(`driver${key}`)!,
        firstName: "Test",
        lastName: uniqueTestToken(`drv${key}`),
        cniNumber: `CNI-${key}`,
      })
      .returning();
    driverRows[key] = driver.id;
    const [mission] = await db
      .insert(missions)
      .values({ orderNumber: uniqueTestToken(`mis${key}`), pickupAddress: "Douala", deliveryAddress: "Yaoundé" })
      .returning();
    missionRows[key] = mission.id;
    await db.insert(assignments).values({ missionId: mission.id, driverId: driver.id, vehicleId: vehicle[key].id });
  }
}, 60000);

afterAll(async () => {
  const missionIds = Object.values(missionRows);
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  const driverIds = Object.values(driverRows);
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("parc de véhicules : cloison client (R-03)", { timeout: 60000 }, () => {
  it("la liste d'un client ne contient que ses véhicules", async () => {
    const res = await get("/api/vehicles?limit=1000", "clientA");
    expect(res.status).toBe(200);
    expect(idsOf(res.body.vehicles)).toEqual([vehicle.A.id]);
    expect(res.body.total).toBe(1);
    expect(res.body.vehicles[0]).toHaveProperty("createdByName");
  });

  it("la recherche et le tri restent appliqués dans le périmètre", async () => {
    const hit = await get(`/api/vehicles?search=${encodeURIComponent(vehicle.A.plate)}&sort_by=mileage&sort_order=asc`, "clientA");
    expect(idsOf(hit.body.vehicles)).toEqual([vehicle.A.id]);
    const miss = await get(`/api/vehicles?search=${encodeURIComponent(vehicle.B.plate)}`, "clientA");
    expect(miss.status).toBe(200);
    expect(miss.body).toMatchObject({ vehicles: [], total: 0 });
  });

  it("/all ne renvoie ni les véhicules d'un autre client ni ceux sans propriétaire", async () => {
    const res = await get("/api/vehicles/all", "clientA");
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([vehicle.A.id]);
    const other = await get("/api/vehicles/all", "clientB");
    expect(idsOf(other.body)).toEqual([vehicle.B.id]);
  });

  it("check/:immat ne révèle ni le véhicule d'un autre client ni un véhicule sans propriétaire", async () => {
    const own = await get(`/api/vehicles/check/${encodeURIComponent(vehicle.A.plate)}`, "clientA");
    expect(own.body).toEqual({ exists: true, id: vehicle.A.id, registrationNumber: vehicle.A.plate });
    for (const key of ["B", "none"] as const) {
      const res = await get(`/api/vehicles/check/${encodeURIComponent(vehicle[key].plate)}`, "clientA");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ exists: false });
    }
  });

  it("admin et chef d'atelier voient tout le parc", async () => {
    for (const actor of ["admin", "workshop"] as const) {
      const list = await get("/api/vehicles?limit=1000", actor);
      expect(list.status).toBe(200);
      expect(idsOf(list.body.vehicles)).toEqual(expect.arrayContaining([vehicle.A.id, vehicle.B.id, vehicle.none.id]));
      const all = await get("/api/vehicles/all", actor);
      expect(idsOf(all.body)).toEqual(expect.arrayContaining([vehicle.A.id, vehicle.B.id, vehicle.none.id]));
      const check = await get(`/api/vehicles/check/${encodeURIComponent(vehicle.B.plate)}`, actor);
      expect(check.body).toMatchObject({ exists: true, id: vehicle.B.id });
    }
  });
});

describe("chauffeurs et missions : cloison chauffeur (R-13)", { timeout: 60000 }, () => {
  it.each(["/api/drivers/cpc-status", "/api/drivers", "/api/drivers/expiring-cpc"])(
    "%s : un chauffeur ne voit que sa propre fiche",
    async (path) => {
      const res = await get(path, "driverA");
      expect(res.status).toBe(200);
      const seen = res.body.map((row: { userId: number }) => row.userId);
      expect(seen.every((id: number) => id === userIds.get("driverA"))).toBe(true);
    },
  );

  it("cpc-status : le chauffeur A reçoit sa fiche et pas celle de B", async () => {
    const res = await get("/api/drivers/cpc-status", "driverA");
    expect(idsOf(res.body)).toEqual([driverRows.A]);
    expect(JSON.stringify(res.body)).not.toContain("CNI-B");
  });

  it("missions : un chauffeur ne voit que les siennes", async () => {
    const a = await get("/api/missions", "driverA");
    expect(a.status).toBe(200);
    expect(idsOf(a.body)).toEqual([missionRows.A]);
    const b = await get("/api/missions", "driverB");
    expect(idsOf(b.body)).toEqual([missionRows.B]);
  });

  it("admin et chef d'atelier gardent la vue complète", async () => {
    for (const actor of ["admin", "workshop"] as const) {
      const status = await get("/api/drivers/cpc-status", actor);
      expect(idsOf(status.body)).toEqual(expect.arrayContaining([driverRows.A, driverRows.B]));
      const list = await get("/api/missions", actor);
      expect(idsOf(list.body)).toEqual(expect.arrayContaining([missionRows.A, missionRows.B]));
    }
  });

  it("un client reste refusé sur les routes réservées au personnel", async () => {
    expect((await get("/api/drivers/cpc-status", "clientA")).status).toBe(403);
    expect((await get("/api/missions", "clientA")).status).toBe(403);
  });
});

describe("chauffeurs et missions : routes par identifiant et DTO réduit (R-13)", { timeout: 60000 }, () => {
  it.each([
    (id: number) => `/api/drivers/${id}`,
    (id: number) => `/api/drivers/${id}/cpc-status`,
    (id: number) => `/api/drivers/${id}/missions`,
  ])("fiche d'un autre chauffeur : 403 ; la sienne : 200", async (path) => {
    expect((await get(path(driverRows.B), "driverA")).status).toBe(403);
    expect((await get(path(driverRows.A), "driverA")).status).toBe(200);
    expect((await get(path(driverRows.B), "workshop")).status).toBe(200);
  });

  it("mission : 403 si non affectée, 200 si affectée, personnel inchangé", async () => {
    expect((await get(`/api/missions/${missionRows.B}`, "driverA")).status).toBe(403);
    expect((await get(`/api/missions/${missionRows.A}`, "driverA")).status).toBe(200);
    expect((await get(`/api/missions/${missionRows.B}`, "admin")).status).toBe(200);
    expect((await get(`/api/missions/${missionRows.B}`, "workshop")).status).toBe(200);
  });

  it("update-cpc : un chauffeur est refusé en 403, même sur sa fiche", async () => {
    for (const key of ["A", "B"] as const) {
      const res = await fetch(`${baseUrl}/api/drivers/${driverRows[key]}/update-cpc`, {
        method: "POST",
        headers: { Cookie: cookies.get("driverA")!, "Content-Type": "application/json" },
        body: JSON.stringify({ cpcDate: "2026-01-01" }),
      });
      expect(res.status).toBe(403);
    }
  });

  it("gestionnaire (admin) : CNI présente sur liste, cpc-status et détail", async () => {
    const list = await get("/api/drivers", "admin");
    expect(list.body.find((row: { id: number }) => row.id === driverRows.A).cniNumber).toBe("CNI-A");
    const status = await get(`/api/drivers/${driverRows.A}/cpc-status`, "admin");
    expect(status.body.cniNumber).toBe("CNI-A");
    const detail = await get(`/api/drivers/${driverRows.A}`, "admin");
    expect(detail.body.cniNumber).toBe("CNI-A");
  });

  it("workshop_manager : fiche sans CNI, permis ni date de naissance", async () => {
    const forbidden = ["cniNumber", "licenseNumber", "birthDate"];
    const bodies = [
      (await get("/api/drivers", "workshop")).body.find((row: { id: number }) => row.id === driverRows.A),
      (await get("/api/drivers/cpc-status", "workshop")).body.find((row: { id: number }) => row.id === driverRows.A),
      (await get(`/api/drivers/${driverRows.A}/cpc-status`, "workshop")).body,
      (await get(`/api/drivers/${driverRows.A}`, "workshop")).body,
    ];
    for (const body of bodies) {
      expect(body.id).toBe(driverRows.A);
      for (const field of forbidden) expect(body).not.toHaveProperty(field);
    }
  });

  it("chauffeur : garde les champs de sa propre fiche", async () => {
    const res = await get("/api/drivers/cpc-status", "driverA");
    expect(res.body[0].cniNumber).toBe("CNI-A");
  });
});
