import { randomUUID } from "node:crypto";
import connectPgSimple from "connect-pg-simple";
import session, { type SessionData, type Store } from "express-session";
import type { Pool as PgPool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { sessionStore } from "../../server/middleware/session";

/**
 * Store de session sur le Pool neon (`server/middleware/session.ts`).
 *
 * Depuis neon 1.1, le Pool n'a plus le type `pg.Pool` attendu par connect-pg-simple : session.ts le
 * convertit. Ce test prouve que la conversion ne cache pas d'incompatibilité à l'exécution : on écrit,
 * relit, prolonge et détruit une session à travers le vrai store, puis on crée la table à neuf.
 */

function sessionData(maxAgeMs = 60_000): SessionData {
  return {
    cookie: { originalMaxAge: maxAgeMs, expires: new Date(Date.now() + maxAgeMs) },
    passport: { user: 4242 },
  } as unknown as SessionData;
}

const call = <T = void>(run: (cb: (err: unknown, value?: T) => void) => void) =>
  new Promise<T | undefined>((resolve, reject) => run((err, value) => (err ? reject(err) : resolve(value))));

async function roundTrip(store: Store, table: string) {
  const sid = `it-${randomUUID()}`;
  try {
    await call((cb) => store.set(sid, sessionData(), cb));
    const read = await call<SessionData | null>((cb) => store.get(sid, cb));
    expect(read).toMatchObject({ passport: { user: 4242 } });

    // Typé `() => void` par express-session, mais connect-pg-simple y passe l'erreur éventuelle.
    await call((cb) => store.touch!(sid, sessionData(120_000), (err?: unknown) => cb(err)));
    // `expire` est sans fuseau : comparer en SQL, comme connect-pg-simple, et non après relecture
    // par le driver (qui l'interpréterait en heure locale).
    const { rows } = await pool.query(
      `SELECT expire > to_timestamp($2) AS prolonged FROM "${table}" WHERE sid = $1`,
      [sid, (Date.now() + 90_000) / 1000],
    );
    expect(rows).toEqual([{ prolonged: true }]);

    await call((cb) => store.destroy(sid, cb));
    expect(await call<SessionData | null>((cb) => store.get(sid, cb))).toBeFalsy();
  } finally {
    await call((cb) => store.destroy(sid, cb)).catch(() => undefined);
  }
}

describe("store de session sur le Pool neon", () => {
  it("écrit, relit, prolonge et détruit une session (store de production)", async () => {
    await roundTrip(sessionStore, "session");
  });

  describe("table absente", () => {
    // Schéma jetable : le script de connect-pg-simple nomme sa contrainte `session_pkey` en dur,
    // une seconde table dans le même schéma entrerait en collision.
    const schema = `session_it_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const table = `${schema}"."session`;
    const PgSession = connectPgSimple(session);
    const store = new PgSession({
      pool: pool as unknown as PgPool,
      schemaName: schema,
      tableName: "session",
      createTableIfMissing: true,
    });

    beforeAll(async () => {
      await pool.query(`CREATE SCHEMA "${schema}"`);
    });

    afterAll(async () => {
      await store.close();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    });

    it("la crée par le pool puis y fait le même aller-retour", async () => {
      await roundTrip(store, table);
      const { rows } = await pool.query(`SELECT to_regclass($1::text) IS NOT NULL AS created`, [`"${table}"`]);
      expect(rows).toEqual([{ created: true }]);
    });
  });
});
