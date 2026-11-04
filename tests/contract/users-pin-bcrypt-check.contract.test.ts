import bcrypt from "bcryptjs";
import type { PoolClient } from "@neondatabase/serverless";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../../server/db";
import {
  USERS_PIN_BCRYPT_CHECK,
  USERS_PIN_BCRYPT_CHECK_SQL,
  reportUsersPinBcryptGaps,
} from "../../server/init-database";

/**
 * users.pin : CHECK users_pin_bcrypt_check (hash bcrypt ou NULL).
 * Toutes les écritures, DDL compris, se font dans une transaction annulée : la base de test partagée
 * ne garde ni la contrainte ni les comptes TEST (d'autres fichiers y écrivent encore des PIN en clair).
 */

const CHECK = USERS_PIN_BCRYPT_CHECK;
let HASH = "";

async function constraint(q: Pick<PoolClient, "query">) {
  const { rows } = await q.query(
    `SELECT oid::text, convalidated, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE conrelid = 'users'::regclass AND conname = $1`,
    [CHECK],
  );
  return rows[0] as { oid: string; convalidated: boolean; def: string } | undefined;
}

/**
 * Transaction annulée, état de départ maîtrisé : contrainte retirée, PIN en clair éventuels d'autres
 * fichiers neutralisés (NULL), sauf `keepPlain`. `insert(pin)` crée un compte TEST chauffeur.
 */
async function inRolledBackTransaction(
  run: (client: PoolClient, insert: (pin: string | null) => Promise<unknown>) => Promise<void>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS ${CHECK}`);
    await client.query(`UPDATE users SET pin = NULL WHERE pin IS NOT NULL AND pin !~ '^[$]2[aby][$]'`);
    let n = 0;
    const insert = (pin: string | null) => {
      const token = `TEST-pinchk-${Date.now()}-${n++}`;
      return client.query(
        `INSERT INTO users (username, password, email, name, role, pin) VALUES ($1, $2, $3, $1, 'driver', $4)`,
        [token, HASH, `${token}@fleet.test`, pin],
      );
    };
    await run(client, insert);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function attempt(client: PoolClient, write: () => Promise<unknown>) {
  await client.query("SAVEPOINT essai");
  try {
    await write();
    await client.query("RELEASE SAVEPOINT essai");
    return { code: "accepté" as string | undefined, constraint: undefined as string | undefined };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT essai");
    const pg = error as { code?: string; constraint?: string };
    return { code: pg.code, constraint: pg.constraint };
  }
}

describe("users_pin_bcrypt_check en base", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    HASH = await bcrypt.hash("1234", 4); // hors transaction : le verrou sur users reste court
  });

  it("posée et validée sans PIN en clair ; refuse un PIN brut, accepte un hash bcrypt et NULL", async () => {
    await inRolledBackTransaction(async (client, insert) => {
      await client.query(USERS_PIN_BCRYPT_CHECK_SQL);
      const posed = await constraint(client);
      expect(posed?.convalidated).toBe(true);
      expect(posed?.def).toContain("'^[$]2[aby][$]'");

      expect(await attempt(client, () => insert("1234"))).toEqual({ code: "23514", constraint: CHECK });
      expect(await attempt(client, () => insert("$2x$10$pas-bcrypt"))).toEqual({ code: "23514", constraint: CHECK });
      expect((await attempt(client, () => insert(HASH))).code).toBe("accepté");
      expect((await attempt(client, () => insert(null))).code).toBe("accepté");
      // Une mise à jour en clair d'un compte existant est refusée aussi.
      expect(
        await attempt(client, () => client.query(`UPDATE users SET pin = '1234' WHERE username LIKE 'TEST-pinchk-%'`)),
      ).toEqual({ code: "23514", constraint: CHECK });

      const log = { warn: vi.fn() };
      expect(await reportUsersPinBcryptGaps(client, log)).toEqual({ missing: false, notValidated: false, plainPins: 0 });
      expect(log.warn).not.toHaveBeenCalled();
    });
  });

  it("rejouée : aucun changement (même contrainte, même oid, toujours validée)", async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(USERS_PIN_BCRYPT_CHECK_SQL);
      const first = await constraint(client);
      await client.query(USERS_PIN_BCRYPT_CHECK_SQL);
      expect(await constraint(client)).toEqual(first);
    });
  });

  it("PIN en clair présent : contrainte laissée NOT VALID sans erreur, écritures suivantes contrôlées, écart journalisé", async () => {
    await inRolledBackTransaction(async (client, insert) => {
      await insert("4821");
      await expect(client.query(USERS_PIN_BCRYPT_CHECK_SQL)).resolves.toBeDefined();
      expect((await constraint(client))?.convalidated).toBe(false);

      expect(await attempt(client, () => insert("1234"))).toEqual({ code: "23514", constraint: CHECK });

      const log = { warn: vi.fn() };
      expect(await reportUsersPinBcryptGaps(client, log)).toEqual({ missing: false, notValidated: true, plainPins: 1 });
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn.mock.calls[0][1]).toContain(CHECK);
      expect(JSON.stringify(log.warn.mock.calls[0])).not.toContain("4821");

      // Clair repris (haché) : le passage suivant valide la contrainte.
      await client.query(`UPDATE users SET pin = $1 WHERE pin = '4821' AND username LIKE 'TEST-pinchk-%'`, [HASH]);
      await client.query(USERS_PIN_BCRYPT_CHECK_SQL);
      expect((await constraint(client))?.convalidated).toBe(true);
    });
  });

  it("contrainte absente : écart journalisé", async () => {
    await inRolledBackTransaction(async (client) => {
      const log = { warn: vi.fn() };
      expect(await reportUsersPinBcryptGaps(client, log)).toEqual({ missing: true, notValidated: false, plainPins: 0 });
      expect(log.warn).toHaveBeenCalledTimes(1);
    });
  });
});
