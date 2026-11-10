import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { DRIVER_PERSONAL_FIELDS } from "../../server/lib/driver-scope";
import { assignments, drivers, missions } from "../../shared/schema";
import { startContractSession } from "../support/contract-session";
import { uniqueTestToken } from "../support/ids";

/**
 * R-03 / R-13 : cloison du chauffeur sur ses propres données.
 * - `POST /api/drivers/:id/update-cpc` refusé au chauffeur ;
 * - CNI, permis, date de naissance lisibles par les gestionnaires (admin, logistique,
 *   secrétariat) et par le chauffeur concerné, masqués pour tout autre lecteur ;
 * - la diffusion temps réel d'une fiche ne porte aucune donnée personnelle.
 */

type Actor = "admin" | "logistics" | "management" | "driver" | "technician" | "warehouse";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const driverIds: number[] = [];
const missionIds: number[] = [];
let ownId = 0;
let otherId = 0;

const PII = {
  birthDate: "1985-04-12",
  cniNumber: "CNI-SECRET-123",
  cniExpiry: "2030-01-01",
  licenseNumber: "PERMIS-SECRET-456",
  licenseExpiry: "2031-02-02",
  hireDate: "2015-06-01",
};
const PII_KEYS = Object.keys(PII);

async function newDriver(userId: number | null) {
  const [row] = await db
    .insert(drivers)
    .values({ firstName: "Test", lastName: uniqueTestToken("chauffeur"), userId, ...PII })
    .returning();
  driverIds.push(row.id);
  return row.id;
}

const hasPii = (row: Record<string, unknown>) => PII_KEYS.filter((k) => row[k] !== undefined && row[k] !== null);

beforeAll(async () => {
  session = await startContractSession<Actor>({
    admin: "admin",
    logistics: "logistics",
    management: "management",
    driver: "driver",
    technician: "technician",
    warehouse: "warehouse",
  });
  ownId = await newDriver(session.userId("driver"));
  otherId = await newDriver(null);
}, 60000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await session.stop();
});

describe("POST /api/drivers/:id/update-cpc", () => {
  it("refuse le chauffeur (403) sans rien écrire", async () => {
    const res = await session.call("POST", `/api/drivers/${otherId}/update-cpc`, {
      actor: "driver",
      body: { cpcDate: "2026-01-01" },
    });
    expect(res.status).toBe(403);
    const after = await session.call("GET", `/api/drivers/${otherId}`, { actor: "admin" });
    expect(after.body.cpcTrainingDate ?? null).not.toBe("2026-01-01");
  });

  it("refuse technicien, magasinier et direction (403) sans rien écrire", async () => {
    for (const actor of ["technician", "warehouse", "management"] as const) {
      const res = await session.call("POST", `/api/drivers/${otherId}/update-cpc`, {
        actor,
        body: { cpcDate: "2026-02-02" },
      });
      expect(res.status, actor).toBe(403);
    }
    const [row] = await db.select().from(drivers).where(eq(drivers.id, otherId));
    expect(row.cpcTrainingDate ?? null).not.toBe("2026-02-02");
  });

  it("date CPC invalide : 400, pas 500", async () => {
    const res = await session.call("POST", `/api/drivers/${otherId}/update-cpc`, {
      actor: "logistics",
      body: { cpcDate: "pas-une-date" },
    });
    expect(res.status).toBe(400);
  });

  it("accepte la logistique et ne renvoie que la fiche utile", async () => {
    const res = await session.call("POST", `/api/drivers/${otherId}/update-cpc`, {
      actor: "logistics",
      body: { cpcDate: "2026-01-01" },
    });
    expect(res.status).toBe(200);
    expect(res.body.cpcTrainingDate).toBe("2026-01-01");
  });
});

describe("direction (management) : lit sans gérer", () => {
  it("voit les données personnelles en détail et en liste", async () => {
    const detail = await session.call("GET", `/api/drivers/${otherId}`, { actor: "management" });
    expect(detail.status).toBe(200);
    expect(detail.body.cniNumber).toBe(PII.cniNumber);
    expect(detail.body.birthDate).toBe(PII.birthDate);
    const list = await session.call("GET", "/api/drivers", { actor: "management" });
    expect(list.body.find((d: any) => d.id === otherId).licenseNumber).toBe(PII.licenseNumber);
  });

  it("reçoit 403 sur une écriture de gestion (PATCH fiche)", async () => {
    const res = await session.call("PATCH", `/api/drivers/${otherId}`, { actor: "management", body: { firstName: "Refuse" } });
    expect(res.status).toBe(403);
  });
});

describe("fiche chauffeur : données personnelles", () => {
  it("détail : le gestionnaire voit tout", async () => {
    for (const actor of ["admin", "logistics"] as const) {
      const res = await session.call("GET", `/api/drivers/${otherId}`, { actor });
      expect(res.status).toBe(200);
      expect(res.body.cniNumber).toBe(PII.cniNumber);
      expect(res.body.licenseNumber).toBe(PII.licenseNumber);
      expect(res.body.birthDate).toBe(PII.birthDate);
    }
  });

  it("détail : le chauffeur voit la sienne, pas celle d'un autre", async () => {
    const own = await session.call("GET", `/api/drivers/${ownId}`, { actor: "driver" });
    expect(own.status).toBe(200);
    expect(own.body.cniNumber).toBe(PII.cniNumber);
    // Moindre donnée : la fiche d'un autre chauffeur est refusée, pas seulement masquée.
    const other = await session.call("GET", `/api/drivers/${otherId}`, { actor: "driver" });
    expect(other.status).toBe(403);
    expect(hasPii(other.body)).toEqual([]);
  });

  it("détail : un autre personnel (magasinier) ne voit aucune donnée personnelle, le technicien est refusé", async () => {
    const res = await session.call("GET", `/api/drivers/${ownId}`, { actor: "warehouse" });
    expect(res.status).toBe(200);
    expect(hasPii(res.body)).toEqual([]);
    const tech = await session.call("GET", `/api/drivers/${ownId}`, { actor: "technician" });
    expect(tech.status).toBe(403);
  });

  it("listes : mêmes règles sur /api/drivers et /api/drivers/cpc-status", async () => {
    for (const path of ["/api/drivers", "/api/drivers/cpc-status"]) {
      const asLogistics = await session.call("GET", path, { actor: "logistics" });
      const mine = asLogistics.body.find((d: any) => d.id === otherId);
      expect(mine.cniNumber).toBe(PII.cniNumber);

      const asWarehouse = await session.call("GET", path, { actor: "warehouse" });
      expect(asWarehouse.status, path).toBe(200);
      expect(asWarehouse.body.every((d: any) => hasPii(d).length === 0)).toBe(true);

      // Annuaire : ni le chauffeur (il lit sa fiche par /api/drivers/me) ni le technicien.
      for (const actor of ["driver", "technician"] as const) {
        const res = await session.call("GET", path, { actor });
        expect(res.status, `${actor} ${path}`).toBe(403);
      }
    }
  });

  it("GET /api/missions/:id : l'affectation ne porte aucune donnée personnelle du chauffeur", async () => {
    const [mission] = await db
      .insert(missions)
      .values({
        orderNumber: uniqueTestToken("MIS"),
        pickupAddress: "TEST A",
        deliveryAddress: "TEST B",
        status: "assigned",
      } as any)
      .returning();
    missionIds.push(mission.id);
    await db.insert(assignments).values({ missionId: mission.id, driverId: otherId, status: "accepted" } as any);

    for (const actor of ["warehouse", "admin"] as const) {
      const res = await session.call("GET", `/api/missions/${mission.id}`, { actor });
      expect(res.status, actor).toBe(200);
      expect(res.body.assignment.driver.id).toBe(otherId);
      const keys = Object.keys(res.body.assignment.driver);
      expect(keys.filter((k) => (DRIVER_PERSONAL_FIELDS as readonly string[]).includes(k))).toEqual([]);
    }
  });

  it("GET /:id/cpc-status masque pour le magasinier, refusé au technicien, complet pour l'admin", async () => {
    const warehouse = await session.call("GET", `/api/drivers/${otherId}/cpc-status`, { actor: "warehouse" });
    expect(warehouse.status).toBe(200);
    expect(hasPii(warehouse.body)).toEqual([]);
    const tech = await session.call("GET", `/api/drivers/${otherId}/cpc-status`, { actor: "technician" });
    expect(tech.status).toBe(403);
    const admin = await session.call("GET", `/api/drivers/${otherId}/cpc-status`, { actor: "admin" });
    expect(admin.body.cniNumber).toBe(PII.cniNumber);
  });
});

describe("diffusion temps réel d'une fiche chauffeur", () => {
  it("PATCH /api/drivers/:id ne diffuse ni CNI, ni permis, ni date de naissance", async () => {
    const events: Array<{ type: string; data: any }> = [];
    const previous = (global as any).broadcastUpdate;
    (global as any).broadcastUpdate = (type: string, data: unknown) => events.push({ type, data });
    try {
      const res = await session.call("PATCH", `/api/drivers/${otherId}`, {
        actor: "logistics",
        body: { firstName: "TestBis" },
      });
      expect(res.status).toBe(200);
    } finally {
      (global as any).broadcastUpdate = previous;
    }
    const updated = events.find((e) => e.type === "driver_updated");
    expect(updated).toBeDefined();
    expect(updated!.data.entityId).toBe(otherId);
    expect(updated!.data.payload.driver.firstName).toBe("TestBis");
    expect(hasPii(updated!.data.payload.driver)).toEqual([]);
    expect(JSON.stringify(updated!.data)).not.toContain(PII.cniNumber);
  });
});
