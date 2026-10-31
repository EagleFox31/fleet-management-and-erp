import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { fuelAnomalyResolutions, fuelRecords } from "../../shared/schema";
import { fuelAnomalyResolutionService as svc } from "../../server/services/fuel-anomaly-resolution-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";

const ids = createIdBag();
const keys: string[] = [];

afterEach(async () => {
  for (const k of keys) await db.delete(fuelAnomalyResolutions).where(eq(fuelAnomalyResolutions.anomalyKey, k));
  keys.length = 0;
  await cleanupCreated(ids);
  ids.userIds.length = 0;
});

describe("fuelAnomalyResolutionService", () => {
  it("rejoue la résolution sans doublon et le dernier statut l'emporte", async () => {
    const user = await createTestUser();
    ids.userIds.push(user.id);
    const [rec] = await db.insert(fuelRecords).values({ quantity: 10, date: "2019-06-01" }).returning();
    ids.fuelRecordIds.push(rec.id);
    const key = `consumption-gap:${rec.id}`;
    keys.push(key);

    const first = await svc.resolve(key, { status: "justified", comment: "Détour" }, user.id);
    const again = await svc.resolve(key, { status: "justified", comment: "Détour" }, user.id);
    expect(again.anomalyKey).toBe(first.anomalyKey);
    expect(await db.select().from(fuelAnomalyResolutions).where(eq(fuelAnomalyResolutions.anomalyKey, key))).toHaveLength(1);
    expect((await svc.justifiedKeys()).has(key)).toBe(true);

    const changed = await svc.resolve(key, { status: "confirmed" }, user.id);
    expect(changed).toMatchObject({ status: "confirmed", comment: null, resolvedBy: user.id, fuelRecordId: rec.id });
    expect((await svc.justifiedKeys()).has(key)).toBe(false);
    expect((await svc.get(key))?.status).toBe("confirmed");
  }, 30_000);

  it("refuse une clé invalide ou un plein inexistant", async () => {
    await expect(svc.resolve("nimporte", { status: "open" }, 1)).rejects.toMatchObject({ status: 400 });
    await expect(svc.resolve("consumption-gap:2147483000", { status: "open" }, 1)).rejects.toMatchObject({ status: 404 });
  }, 30_000);
});
