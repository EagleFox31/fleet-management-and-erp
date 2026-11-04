import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../server/db";
import { users } from "../../shared/schema";
import { hashPlainUserPins } from "../../server/lib/pin-hash-migration";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";

/** Reprise : `users.pin` en clair vers bcrypt, idempotente. */

const ids = createIdBag();

async function setPin(pin: string | null) {
  const user = await createTestUser({ role: "driver" });
  ids.userIds.push(user.id);
  await db.update(users).set({ pin }).where(eq(users.id, user.id));
  return user.id;
}
const pinOf = async (id: number) => (await db.select({ pin: users.pin }).from(users).where(eq(users.id, id)))[0].pin;

describe("reprise des PIN en clair", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    await hashPlainUserPins(pool); // état propre : plus de clair laissé par d'autres fichiers
  });
  afterAll(async () => {
    await cleanupCreated(ids);
  });

  it("hache un PIN en clair (conforme ou non), laisse un hash et NULL intacts, second passage à 0 écriture", async () => {
    const plain = await setPin("4821");
    const odd = await setPin("12");
    const existing = await bcrypt.hash("9999", 4);
    const kept = await setPin(existing);
    const none = await setPin(null);

    const first = await hashPlainUserPins(pool);
    expect(first.hashed).toBe(2);

    const hashed = (await pinOf(plain))!;
    expect(hashed.startsWith("$2")).toBe(true);
    expect(await bcrypt.compare("4821", hashed)).toBe(true);
    expect(await bcrypt.compare("12", (await pinOf(odd))!)).toBe(true);
    expect(await pinOf(kept)).toBe(existing);
    expect(await pinOf(none)).toBeNull();

    const second = await hashPlainUserPins(pool);
    expect(second.hashed).toBe(0);
    expect(await pinOf(plain)).toBe(hashed);
  });
});
