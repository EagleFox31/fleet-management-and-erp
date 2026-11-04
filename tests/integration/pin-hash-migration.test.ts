import bcrypt from "bcryptjs";
import type { PoolClient } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { hashPlainUserPins } from "../../server/lib/pin-hash-migration";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";

/**
 * Reprise : `users.pin` en clair vers bcrypt, idempotente.
 * La CHECK users_pin_bcrypt_check refuse tout PIN en clair : le clair n'est écrit que dans une transaction
 * annulée qui retire la contrainte, comme sur une base antérieure à elle. Rien ne reste en base.
 */

const ids = createIdBag();
let accounts: number[] = [];

const pinOf = async (client: PoolClient, id: number) =>
  (await client.query(`SELECT pin FROM users WHERE id = $1`, [id])).rows[0].pin as string | null;

describe("reprise des PIN en clair", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    for (let i = 0; i < 5; i++) ids.userIds.push((await createTestUser({ role: "driver" })).id);
    accounts = [...ids.userIds];
  });
  afterAll(async () => {
    await cleanupCreated(ids);
  });

  it("hache un PIN en clair (conforme ou non), laisse un hash et NULL intacts, second passage à 0 écriture", async () => {
    const existing = await bcrypt.hash("9999", 4);
    const [plain, odd, kept, none, extra] = accounts;
    const malformed = "$2x$10$abcdefghijklmnopqrstuv"; // ressemble à un hash, préfixe hors a/b/y
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pin_bcrypt_check");
      await hashPlainUserPins(client); // état propre : plus de clair laissé par d'autres fichiers
      const setPin = (id: number, pin: string | null) => client.query(`UPDATE users SET pin = $1 WHERE id = $2`, [pin, id]);
      await setPin(plain, "4821");
      await setPin(odd, "12");
      await setPin(kept, existing);
      await setPin(none, null);
      await setPin(extra, malformed);

      const first = await hashPlainUserPins(client);
      expect(first.hashed).toBe(2);

      const hashed = (await pinOf(client, plain))!;
      expect(hashed).toMatch(/^[$]2[aby][$]/);
      expect(await bcrypt.compare("4821", hashed)).toBe(true);
      expect(await bcrypt.compare("12", (await pinOf(client, odd))!)).toBe(true);
      expect(await pinOf(client, kept)).toBe(existing);
      expect(await pinOf(client, none)).toBeNull();
      expect(await pinOf(client, extra)).toBe(malformed); // jamais réécrit

      const second = await hashPlainUserPins(client);
      expect(second.hashed).toBe(0);
      expect(await pinOf(client, plain)).toBe(hashed);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
