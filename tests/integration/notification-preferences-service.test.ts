import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { notificationPreferences } from "../../shared/schema";
import { db } from "../../server/db";
import { filterUsersByTopic, shouldNotify } from "../../server/services/notification-preferences-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";

const ids = createIdBag();

afterEach(async () => {
  for (const userId of ids.userIds) await db.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  await cleanupCreated(ids);
  ids.userIds.length = 0;
});

describe("notification-preferences-service (T-17b)", () => {
  it("par défaut tout le monde est notifié in-app, personne par e-mail", async () => {
    const a = await createTestUser();
    ids.userIds.push(a.id);
    expect(await shouldNotify(a.id, "maintenance")).toBe(true);
    expect(await shouldNotify(a.id, "maintenance", "email")).toBe(false);
  });

  it("couper un thème pour un utilisateur ne touche ni les autres thèmes ni les autres utilisateurs", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    ids.userIds.push(a.id, b.id);
    await db.insert(notificationPreferences).values({ userId: a.id, topic: "fuel", inApp: false, email: false });

    expect(await filterUsersByTopic([a.id, b.id], "fuel")).toEqual([b.id]);
    expect(await filterUsersByTopic([a.id, b.id], "maintenance")).toEqual([a.id, b.id]);
    expect(await filterUsersByTopic([], "fuel")).toEqual([]);
  });
});
