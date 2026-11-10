import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { leakText } from "../support/api-error";
import { uniqueTestToken } from "../support/ids";

/**
 * Éligibilité CPC calculée par le serveur et jointe à chaque affectation de mission
 * (`assignment.driver.cpcEligible` / `cpcIneligibleReason`), lue par GET /api/missions et
 * GET /api/missions/:id.
 * Cloison de #127 : la date de formation ne sort jamais, le libellé ne contient aucune date,
 * un client n'accède pas aux missions, un chauffeur ne reçoit le verdict que pour sa propre fiche.
 */

const ACTORS = { logistics: "logistics", driver: "driver", client: "client", technician: "technician", warehouse: "warehouse" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);

const DATE_IN_TEXT = /\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

async function newDriver(cpcStatus: string, cpcTrainingDate: string | null, userId: number | null = null) {
  const [d] = await db
    .insert(drivers)
    .values({
      firstName: "TEST",
      lastName: uniqueTestToken("drv"),
      employeeNumber: uniqueTestToken("emp"),
      cpcStatus,
      cpcTrainingDate,
      userId,
      isActive: true,
    } as any)
    .returning();
  driverIds.push(d.id);
  return d;
}

// Un compte n'a qu'une fiche chauffeur (uq_drivers_user_id) : créée une fois, son CPC réécrit à chaque cas.
let ownDriverId: number | null = null;
async function ownDriver(cpcStatus: string, cpcTrainingDate: string | null) {
  if (ownDriverId === null) {
    ownDriverId = (await newDriver(cpcStatus, cpcTrainingDate, session.userIdOf("driver"))).id;
  } else {
    await db.update(drivers).set({ cpcStatus, cpcTrainingDate } as any).where(eq(drivers.id, ownDriverId));
  }
  return { id: ownDriverId };
}

async function missionWith(...driverIdList: number[]) {
  const [m] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("MIS"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "assigned" } as any)
    .returning();
  missionIds.push(m.id);
  for (const driverId of driverIdList) {
    await db.insert(assignments).values({ missionId: m.id, driverId, status: "accepted" } as any);
  }
  return m.id;
}

async function driverOfDetail(missionId: number, actor: Actor = "logistics") {
  const res = await call("GET", `/api/missions/${missionId}`, { actor });
  expect(res.status).toBe(200);
  return { res, driver: res.body.assignment.driver };
}

async function driverOfList(missionId: number, actor: Actor = "logistics") {
  const res = await call("GET", "/api/missions", { actor });
  expect(res.status).toBe(200);
  const mission = (res.body as any[]).find((m) => m.id === missionId);
  expect(mission).toBeTruthy();
  return { res, driver: mission.assignment.driver };
}

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
});

describe("verdict CPC des affectations de mission", () => {
  const cases: Array<{ name: string; status: string; date: string | null; eligible: boolean }> = [
    { name: "FORMÉ formé il y a 800 jours (expiré)", status: "FORMÉ", date: daysAgo(800), eligible: false },
    { name: "FORMÉ formé il y a 100 jours", status: "FORMÉ", date: daysAgo(100), eligible: true },
    { name: "NON FORMÉ", status: "NON FORMÉ", date: null, eligible: false },
    // Comportement actuel de la règle partagée : question ouverte, aucune décision métier.
    { name: "FORMÉ sans date : comportement actuel, question ouverte", status: "FORMÉ", date: null, eligible: true },
  ];

  for (const c of cases) {
    it(`${c.name} : cpcEligible ${c.eligible}, liste et détail`, async () => {
      const d = await newDriver(c.status, c.date);
      const missionId = await missionWith(d.id);
      for (const read of [driverOfList, driverOfDetail]) {
        const { res, driver } = await read(missionId);
        expect(driver.cpcEligible).toBe(c.eligible);
        if (c.eligible) {
          expect(driver.cpcIneligibleReason).toBeNull();
        } else {
          expect(typeof driver.cpcIneligibleReason).toBe("string");
          expect(driver.cpcIneligibleReason.length).toBeGreaterThan(0);
        }
        // Cloison #127 : ni la date de formation, ni une date dans le libellé.
        expect("cpcTrainingDate" in driver).toBe(false);
        expect(driver.cpcIneligibleReason ?? "").not.toMatch(DATE_IN_TEXT);
        expect(leakText(res.body)).not.toContain("cpcTrainingDate");
        if (c.date) expect(leakText(res.body)).not.toContain(c.date);
      }
    }, 60000);
  }

  it("formation expirée : libellé fixe identique d'un chauffeur à l'autre", async () => {
    const a = await newDriver("FORMÉ", daysAgo(800));
    const b = await newDriver("FORMÉ", daysAgo(1200));
    const ra = await missionWith(a.id);
    const rb = await missionWith(b.id);
    const la = (await driverOfDetail(ra)).driver;
    const lb = (await driverOfDetail(rb)).driver;
    expect(la.cpcIneligibleReason).toBe("Formation CPC expirée.");
    expect(lb.cpcIneligibleReason).toBe(la.cpcIneligibleReason);
  }, 60000);

  it("FORMÉ daté du futur (import SQL) : inéligible", async () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const d = await newDriver("FORMÉ", future);
    const { driver, res } = await driverOfDetail(await missionWith(d.id));
    expect(driver.cpcEligible).toBe(false);
    expect(driver.cpcIneligibleReason).not.toMatch(DATE_IN_TEXT);
    expect(leakText(res.body)).not.toContain(future);
  }, 60000);

  it("magasinier (personnel) : même verdict que la logistique", async () => {
    const d = await newDriver("FORMÉ", daysAgo(800));
    const { driver } = await driverOfDetail(await missionWith(d.id), "warehouse");
    expect(driver.cpcEligible).toBe(false);
  }, 60000);

  it("technicien : fiche mission refusée (aucun écran mission)", async () => {
    const d = await newDriver("FORMÉ", daysAgo(800));
    const res = await call("GET", `/api/missions/${await missionWith(d.id)}`, { actor: "technician" });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("cpcEligible");
  }, 60000);

  describe("cloison de #127", () => {
    it("client : accès refusé (403), aucun champ de verdict ni de chauffeur dans la réponse", async () => {
      const d = await newDriver("FORMÉ", daysAgo(800));
      const missionId = await missionWith(d.id);
      for (const path of ["/api/missions", `/api/missions/${missionId}`]) {
        const res = await call("GET", path, { actor: "client" });
        expect(res.status).toBe(403);
        const text = leakText(res.body);
        expect(text).not.toContain("cpcEligible");
        expect(text).not.toContain("cpcIneligibleReason");
        expect(text).not.toContain(d.employeeNumber as string);
      }
    }, 60000);

    it("chauffeur : verdict sur sa propre affectation", async () => {
      const own = await ownDriver("FORMÉ", daysAgo(800));
      const { driver } = await driverOfDetail(await missionWith(own.id), "driver");
      expect(driver.id).toBe(own.id);
      expect(driver.cpcEligible).toBe(false);
      expect("cpcTrainingDate" in driver).toBe(false);
    }, 60000);

    it("chauffeur sur une mission partagée : rien de l'autre chauffeur", async () => {
      const own = await ownDriver("FORMÉ", daysAgo(100));
      const other = await newDriver("NON FORMÉ", null);
      const missionId = await missionWith(own.id, other.id);

      const detail = await call("GET", `/api/missions/${missionId}`, { actor: "driver" });
      expect(detail.status).toBe(200);
      const listed = ((await call("GET", "/api/missions", { actor: "driver" })).body as any[]).find((m) => m.id === missionId);
      for (const payload of [detail.body, listed]) {
        expect(payload.assignments.map((a: any) => a.driver.id)).toEqual([own.id]);
        expect(payload.assignment.driver.id).toBe(own.id);
        expect(leakText(payload)).not.toContain(other.employeeNumber as string);
      }
    }, 60000);

    it("chauffeur : mission d'un autre chauffeur seulement, absente de la liste et sans verdict", async () => {
      await ownDriver("FORMÉ", daysAgo(100));
      const other = await newDriver("NON FORMÉ", null);
      const missionId = await missionWith(other.id);

      const detail = await call("GET", `/api/missions/${missionId}`, { actor: "driver" });
      expect(leakText(detail.body)).not.toContain("cpcEligible");
      const list = await call("GET", "/api/missions", { actor: "driver" });
      expect((list.body as any[]).some((m) => m.id === missionId)).toBe(false);
    }, 60000);
  });
});

/** Toutes les clés d'un JSON, à tout niveau (objets et tableaux imbriqués). */
function collectKeys(node: unknown, into: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectKeys(item, into);
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      into.push(key);
      collectKeys(value, into);
    }
  }
  return into;
}

describe("parcours récursif : aucune fuite du CPC d'un autre chauffeur ni de la date", () => {
  const DATE_FR = /\d{2}\/\d{2}\/\d{4}/;

  it("chauffeur sur une mission partagée : liste, détail et launch-readiness", async () => {
    const own = await ownDriver("FORMÉ", daysAgo(100));
    const other = await newDriver("FORMÉ", daysAgo(800));
    // L'autre chauffeur est affecté en premier : sans portée, launch-readiness lirait sa fiche.
    const missionId = await missionWith(other.id, own.id);

    const detail = await call("GET", `/api/missions/${missionId}`, { actor: "driver" });
    const list = await call("GET", "/api/missions", { actor: "driver" });
    const readiness = await call("GET", `/api/missions/${missionId}/launch-readiness`, { actor: "driver" });
    expect([detail.status, list.status, readiness.status]).toEqual([200, 200, 200]);

    const listed = (list.body as any[]).find((m) => m.id === missionId);
    for (const [name, body] of [["liste", listed], ["détail", detail.body], ["launch-readiness", readiness.body]] as const) {
      const keys = collectKeys(body);
      expect(keys, name).not.toContain("cpcTrainingDate");
      expect(leakText(body), name).not.toContain(other.employeeNumber as string);
      expect(leakText(body), name).not.toContain(daysAgo(800));
    }

    // Fiche de l'autre chauffeur : ni cpcEligible ni cpcIneligibleCode, nulle part.
    for (const body of [listed, detail.body]) {
      const others = (body.assignments as any[]).filter((a) => a.driver?.id === other.id);
      expect(others).toEqual([]);
    }
    // launch-readiness porte sur la fiche du lecteur (éligible) : aucun motif d'inéligibilité.
    const check = readiness.body.checks.find((c: any) => c.key === "driver_cpc_valid");
    expect(check.passed).toBe(true);
    expect(collectKeys(readiness.body)).not.toContain("cpcIneligibleCode");
    expect(check.detail).not.toMatch(DATE_FR);
  }, 60000);

  it("chauffeur : launch-readiness d'une mission qui ne lui est pas affectée refusé (403)", async () => {
    await ownDriver("FORMÉ", daysAgo(100));
    const other = await newDriver("FORMÉ", daysAgo(800));
    const missionId = await missionWith(other.id);
    const res = await call("GET", `/api/missions/${missionId}/launch-readiness`, { actor: "driver" });
    expect(res.status).toBe(403);
    expect(collectKeys(res.body)).not.toContain("cpcIneligibleCode");
    expect(leakText(res.body)).not.toContain(other.employeeNumber as string);
  }, 60000);

  it("personnel : launch-readiness donne le code et un libellé fixe, sans date", async () => {
    const d = await newDriver("FORMÉ", daysAgo(800));
    const missionId = await missionWith(d.id);
    const res = await call("GET", `/api/missions/${missionId}/launch-readiness`, { actor: "logistics" });
    expect(res.status).toBe(200);
    const keys = collectKeys(res.body);
    expect(keys).not.toContain("cpcTrainingDate");
    const check = res.body.checks.find((c: any) => c.key === "driver_cpc_valid");
    expect(check.passed).toBe(false);
    expect(check.cpcIneligibleCode).toBe("EXPIRED");
    expect(check.detail).toBe("Formation CPC expirée.");
    for (const failure of res.body.blockingFailures) expect(failure.detail).not.toMatch(DATE_FR);
    expect(leakText(res.body)).not.toContain(daysAgo(800));
  }, 60000);

  it("liste et détail : cpcIneligibleCode à côté du libellé", async () => {
    const d = await newDriver("NON FORMÉ", null);
    const missionId = await missionWith(d.id);
    for (const read of [driverOfList, driverOfDetail]) {
      const { driver } = await read(missionId);
      expect(driver.cpcIneligibleCode).toBe("NOT_VALID");
    }
  }, 60000);
});

