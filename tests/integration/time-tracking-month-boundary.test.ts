import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { timeTracking } from "../../shared/schema";
import { timeTrackingService as svc } from "../../server/services/time-tracking-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";

/**
 * WO6 : bord de mois, d'année, 29 février et fuseau horaire des pointages.
 *
 * `date` est une colonne `date` sans heure ; `month` et `year` sont tirés de la chaîne reçue,
 * jamais d'un objet `Date`. Le pointage du 31 d'un mois ne doit donc jamais glisser sur le mois
 * suivant, quel que soit le fuseau du processus. Année 2033 : aucune autre suite n'y écrit.
 */
const ids = createIdBag();
let userId = 0;
const originalTz = process.env.TZ;

beforeAll(async () => {
  const u = await createTestUser({ role: "driver" });
  ids.userIds.push(u.id);
  userId = u.id;
}, 30_000);

afterAll(async () => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
  if (userId) await db.delete(timeTracking).where(eq(timeTracking.userId, userId));
  await cleanupCreated(ids);
}, 30_000);

async function stored() {
  return db.select().from(timeTracking).where(eq(timeTracking.userId, userId));
}

describe("pointages : bord de mois et d'année", () => {
  it("le dernier jour d'un mois reste dans son mois, le lendemain ouvre le suivant", async () => {
    await svc.upsert({ userId, date: "2033-03-31", status: "JT" });
    await svc.upsert({ userId, date: "2033-04-01", status: "M" });

    expect((await svc.list({ userId, month: 3, year: 2033 })).map((e) => e.date)).toEqual(["2033-03-31"]);
    expect((await svc.list({ userId, month: 4, year: 2033 })).map((e) => e.date)).toEqual(["2033-04-01"]);

    const march = (await svc.monthlyStats({ month: 3, year: 2033 })).find((s) => s.userId === userId);
    const april = (await svc.monthlyStats({ month: 4, year: 2033 })).find((s) => s.userId === userId);
    expect(march?.counts).toMatchObject({ JT: 1, M: 0 });
    expect(april?.counts).toMatchObject({ JT: 0, M: 1 });
  }, 30_000);

  it("31 décembre et 1er janvier : l'année change avec le mois", async () => {
    await svc.upsert({ userId, date: "2033-12-31", status: "JT" });
    await svc.upsert({ userId, date: "2034-01-01", status: "JT" });

    const rows = await stored();
    expect(rows.find((r) => r.month === 12)).toMatchObject({ month: 12, year: 2033 });
    expect(rows.find((r) => r.month === 1)).toMatchObject({ month: 1, year: 2034 });
    expect(await svc.list({ userId, month: 12, year: 2033 })).toHaveLength(1);
    expect(await svc.list({ userId, month: 1, year: 2034 })).toHaveLength(1);
  }, 30_000);

  it("le 29 février d'une année bissextile est accepté et reste en février", async () => {
    await svc.upsert({ userId, date: "2032-02-29", status: "C" });
    expect((await svc.list({ userId, month: 2, year: 2032 })).map((e) => e.date)).toEqual(["2032-02-29"]);
    expect(await svc.list({ userId, month: 3, year: 2032 })).toHaveLength(0);
  }, 30_000);

  it("rejouer le dernier jour du mois ne le déplace pas et ne le double pas", async () => {
    const before = (await stored()).length;
    await svc.upsert({ userId, date: "2033-03-31", status: "R" });
    await svc.upsert({ userId, date: "2033-03-31", status: "R" });
    expect(await stored()).toHaveLength(before);
    const [row] = await svc.list({ userId, month: 3, year: 2033 });
    expect(row).toMatchObject({ date: "2033-03-31", status: "R" });
  }, 30_000);
});

describe("pointages : fuseau horaire du processus", () => {
  // Les fuseaux extrêmes encadrent minuit UTC : Kiritimati (+14) et Pago Pago (-11).
  for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "America/Los_Angeles", "UTC"]) {
    it(`le jour saisi est le jour stocké et relu sous TZ=${tz}`, async () => {
      process.env.TZ = tz;
      await svc.upsert({ userId, date: "2033-05-31", status: "JT" });
      await svc.upsert({ userId, date: "2033-06-01", status: "Re" });

      const may = await svc.list({ userId, month: 5, year: 2033 });
      const june = await svc.list({ userId, month: 6, year: 2033 });
      expect(may.map((e) => e.date)).toEqual(["2033-05-31"]);
      expect(june.map((e) => e.date)).toEqual(["2033-06-01"]);
      const rows = (await stored()).filter((r) => r.year === 2033 && (r.month === 5 || r.month === 6));
      expect(rows.map((r) => r.month).sort()).toEqual([5, 6]);
    }, 30_000);
  }
});

describe("pointages : date impossible", () => {
  it("30 février : refus 400", async () => {
    await expect(svc.upsert({ userId, date: "2033-02-30", status: "JT" })).rejects.toMatchObject({ status: 400 });
  }, 30_000);

  it("29 février d'une année non bissextile : refus 400", async () => {
    await expect(svc.upsert({ userId, date: "2033-02-29", status: "JT" })).rejects.toMatchObject({ status: 400 });
  }, 30_000);
});
