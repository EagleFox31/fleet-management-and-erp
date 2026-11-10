import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions } from "../../shared/schema";
import { startContractSession } from "../support/contract-session";
import { uniqueTestToken } from "../support/ids";

/**
 * Moindre donnée pour le chauffeur et le technicien : ni l'un ni l'autre n'a d'écran sur l'annuaire
 * des chauffeurs, leurs CPC, les missions d'un autre chauffeur ou les preuves de livraison. Le
 * technicien n'a en plus aucune lecture de mission ni d'exploitation (MISSION_READ_ROLES). Le
 * chauffeur garde ses propres missions et le POD des siennes ; le reste du personnel garde tout.
 */
type Actor = "logistics" | "warehouse" | "driver" | "technician";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const driverIds: number[] = [];
const missionIds: number[] = [];
let ownId = 0;
let otherId = 0;
let ownMissionId = 0;
let otherMissionId = 0;

async function newDriver(userId: number | null) {
  const [row] = await db
    .insert(drivers)
    .values({ firstName: "Test", lastName: uniqueTestToken("moindre"), userId } as any)
    .returning({ id: drivers.id });
  driverIds.push(row.id);
  return row.id;
}

async function newMission(driverId: number) {
  const [mission] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("MIS"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "in_progress" } as any)
    .returning({ id: missions.id });
  missionIds.push(mission.id);
  await db.insert(assignments).values({ missionId: mission.id, driverId, status: "accepted" } as any);
  return mission.id;
}

beforeAll(async () => {
  session = await startContractSession<Actor>({
    logistics: "logistics",
    warehouse: "warehouse",
    driver: "driver",
    technician: "technician",
  });
  ownId = await newDriver(session.userId("driver"));
  otherId = await newDriver(null);
  ownMissionId = await newMission(ownId);
  otherMissionId = await newMission(otherId);
}, 60000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await session.stop();
});

describe("annuaire CPC des chauffeurs", { timeout: 60000 }, () => {
  it.each(["/api/drivers/expiring-cpc", "/api/drivers/cpc-statistics"])("%s : refusé au chauffeur et au technicien, ouvert au reste du personnel", async (path) => {
    for (const actor of ["driver", "technician"] as const) {
      const res = await session.call("GET", path, { actor });
      expect(res.status, actor).toBe(403);
    }
    for (const actor of ["logistics", "warehouse"] as const) {
      const res = await session.call("GET", path, { actor });
      expect(res.status, actor).toBe(200);
    }
  });

  it("GET /api/drivers/me reste ouvert au chauffeur", async () => {
    const res = await session.call("GET", "/api/drivers/me", { actor: "driver" });
    expect(res.status).toBe(200);
  });
});

describe("GET /api/drivers/:id/missions", { timeout: 60000 }, () => {
  it("chauffeur : les siennes, pas celles d'un autre", async () => {
    const own = await session.call("GET", `/api/drivers/${ownId}/missions`, { actor: "driver" });
    expect(own.status).toBe(200);
    expect(own.body.map((m: any) => m.id)).toContain(ownMissionId);
    const other = await session.call("GET", `/api/drivers/${otherId}/missions`, { actor: "driver" });
    expect(other.status).toBe(403);
  });

  it("technicien refusé (adresses et clients d'un chauffeur), logistique ouverte", async () => {
    const tech = await session.call("GET", `/api/drivers/${otherId}/missions`, { actor: "technician" });
    expect(tech.status).toBe(403);
    expect(JSON.stringify(tech.body)).not.toContain("TEST A");
    const logistics = await session.call("GET", `/api/drivers/${otherId}/missions`, { actor: "logistics" });
    expect(logistics.status).toBe(200);
    expect(logistics.body.map((m: any) => m.id)).toContain(otherMissionId);
  });
});

describe("POD d'une mission en lecture", { timeout: 60000 }, () => {
  it("liste et fichier refusés au technicien", async () => {
    const list = await session.call("GET", `/api/missions/${otherMissionId}/pod-files`, { actor: "technician" });
    expect(list.status).toBe(403);
    const file = await session.call("GET", `/api/missions/${otherMissionId}/pod-files/1`, { actor: "technician" });
    expect(file.status).toBe(403);
  });

  it("logistique et chauffeur affecté gardent la liste ; un autre chauffeur est refusé", async () => {
    const logistics = await session.call("GET", `/api/missions/${otherMissionId}/pod-files`, { actor: "logistics" });
    expect(logistics.status).toBe(200);
    const own = await session.call("GET", `/api/missions/${ownMissionId}/pod-files`, { actor: "driver" });
    expect(own.status).toBe(200);
    const other = await session.call("GET", `/api/missions/${otherMissionId}/pod-files`, { actor: "driver" });
    expect(other.status).toBe(403);
  });
});

describe("autres lectures de mission et d'exploitation", { timeout: 60000 }, () => {
  const missionPaths = () => [
    `/api/missions/${otherMissionId}/launch-readiness`,
    `/api/missions/${otherMissionId}/document-renewal-requests`,
    "/api/operations/missions",
    "/api/operations/missions/upcoming",
    "/api/operations/missions/active",
    "/api/operations/missions/by-client/TEST",
    "/api/operations/stats/by-client",
    "/api/operations/stats/by-destination",
    `/api/operations/missions/${otherMissionId}/costs`,
  ];

  it("technicien refusé partout, sans donnée de mission dans le refus", async () => {
    for (const path of missionPaths()) {
      const res = await session.call("GET", path, { actor: "technician" });
      expect(res.status, path).toBe(403);
      expect(JSON.stringify(res.body), path).not.toContain("TEST B");
    }
  });

  it("logistique garde l'accès", async () => {
    for (const path of missionPaths()) {
      const res = await session.call("GET", path, { actor: "logistics" });
      expect([401, 403], path).not.toContain(res.status);
    }
  });

  it("chauffeur : sa mission et ses listes d'exploitation restent lisibles", async () => {
    const readiness = await session.call("GET", `/api/missions/${ownMissionId}/launch-readiness`, { actor: "driver" });
    expect(readiness.status).toBe(200);
    const active = await session.call("GET", "/api/operations/missions/active", { actor: "driver" });
    expect(active.status).toBe(200);
    expect(active.body.map((m: any) => m.id)).toContain(ownMissionId);
    expect(active.body.map((m: any) => m.id)).not.toContain(otherMissionId);
  });
});
