import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../server/db";
import { users } from "../../shared/schema";
import { revokePinDerivedDriverPasswords } from "../../server/init-database";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Reprise des comptes chauffeur dont le mot de passe était le PIN haché : mot de passe remplacé,
 * PIN intact, second passage sans écriture, comptes non concernés intacts.
 */
const ids = createIdBag();
const PIN = "7312";
let derived: number[] = [];
let healthy = 0;
let nonDriver = 0;
let pinHash = "";
let passwordBefore = "";
let nonDriverPassword = "";

beforeAll(async () => {
  pinHash = await bcrypt.hash(PIN, 4);
  for (let i = 0; i < 3; i++) {
    const u = await createTestUser({ role: "driver" });
    ids.userIds.push(u.id);
    derived.push(u.id);
    await db.update(users).set({ pin: pinHash, password: pinHash }).where(eq(users.id, u.id));
  }
  const ok = await createTestUser({ role: "driver" });
  ids.userIds.push(ok.id);
  healthy = ok.id;
  await db.update(users).set({ pin: pinHash }).where(eq(users.id, ok.id));
  const [okRow] = await db.select().from(users).where(eq(users.id, ok.id));
  passwordBefore = okRow.password;
  // Même hash en mot de passe et PIN, mais rôle autre que chauffeur : hors périmètre.
  const other = await createTestUser({ role: "warehouse" });
  ids.userIds.push(other.id);
  nonDriver = other.id;
  await db.update(users).set({ pin: pinHash, password: pinHash }).where(eq(users.id, other.id));
  nonDriverPassword = pinHash;
});

afterAll(async () => {
  await cleanupCreated(ids);
});

describe("reprise des mots de passe chauffeur dérivés du PIN", { timeout: 60000 }, () => {
  it("premier passage : les comptes dérivés sont repris, second passage : 0 écriture, PIN inchangé", async () => {
    const first = await revokePinDerivedDriverPasswords(pool);
    expect(first).toBeGreaterThanOrEqual(derived.length);

    const rows = await db.select().from(users).where(inArray(users.id, derived));
    for (const row of rows) {
      expect(row.pin).toBe(pinHash);
      expect(row.password).not.toBe(pinHash);
      expect(await bcrypt.compare(PIN, row.password)).toBe(false);
    }
    expect(new Set(rows.map((r) => r.password)).size).toBe(derived.length);

    const second = await revokePinDerivedDriverPasswords(pool);
    expect(second).toBe(0);
    const again = await db.select().from(users).where(inArray(users.id, derived));
    expect(again.map((r) => r.password).sort()).toEqual(rows.map((r) => r.password).sort());
  });

  it("un chauffeur au mot de passe distinct et un compte non chauffeur ne sont pas touchés", async () => {
    const [ok] = await db.select().from(users).where(eq(users.id, healthy));
    expect(ok.password).toBe(passwordBefore);
    expect(await bcrypt.compare(TEST_USER_PASSWORD, ok.password)).toBe(true);
    const [other] = await db.select().from(users).where(eq(users.id, nonDriver));
    expect(other.password).toBe(nonDriverPassword);
  });
});
