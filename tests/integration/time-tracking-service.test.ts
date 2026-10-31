import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { timeTracking } from "../../shared/schema";
import { timeTrackingService as svc } from "../../server/services/time-tracking-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";

const ids = createIdBag();
const userIds: number[] = [];

afterEach(async () => {
  for (const id of userIds) await db.delete(timeTracking).where(eq(timeTracking.userId, id));
  userIds.length = 0;
  await cleanupCreated(ids);
  ids.userIds.length = 0;
});

describe("timeTrackingService", () => {
  it("upsert idempotent : une seule ligne par personne et par jour", async () => {
    const u = await createTestUser({ role: "driver" });
    ids.userIds.push(u.id);
    userIds.push(u.id);

    await svc.upsert({ userId: u.id, date: "2019-09-02", status: "JT" });
    const second = await svc.upsert({ userId: u.id, date: "2019-09-02", status: "M", notes: "Fièvre" });
    expect(second).toEqual({ userId: u.id, date: "2019-09-02", status: "M", notes: "Fièvre" });

    const rows = await db.select().from(timeTracking).where(eq(timeTracking.userId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ month: 9, year: 2019 });
  }, 30_000);

  it("calcule les totaux mensuels à la lecture, sans écrire", async () => {
    const u = await createTestUser({ role: "driver" });
    ids.userIds.push(u.id);
    userIds.push(u.id);
    for (const [d, s] of [["2019-10-01", "JT"], ["2019-10-02", "JT"], ["2019-10-03", "C"], ["2019-11-01", "JT"]] as const) {
      await svc.upsert({ userId: u.id, date: d, status: s });
    }
    const stats = await svc.monthlyStats({ month: 10, year: 2019 });
    const mine = stats.find((s) => s.userId === u.id);
    expect(mine?.counts).toMatchObject({ JT: 2, C: 1, M: 0, Mi: 0, A: 0, R: 0, Re: 0 });
    expect(await svc.list({ userId: u.id, month: 10, year: 2019 })).toHaveLength(3);
  }, 30_000);

  it("refuse un code inconnu", async () => {
    await expect(svc.upsert({ userId: 1, date: "2019-09-02", status: "XX" as never })).rejects.toMatchObject({ status: 400 });
  }, 30_000);
});
