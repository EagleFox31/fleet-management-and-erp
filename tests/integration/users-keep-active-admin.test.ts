import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../server/db";
import { USERS_KEEP_ACTIVE_ADMIN_SQL } from "../../server/init-database";
import { isLastActiveAdminViolation } from "../../server/lib/pg-errors";
import { users } from "../../shared/schema";
import { uniqueTestToken } from "../support/ids";

/**
 * Trigger « au moins un administrateur actif » : refus en base, quel que soit l'appelant.
 * Les administrateurs existants sont écartés (rôle driver, en transaction annulée) pour isoler le cas.
 */
const created: number[] = [];

async function makeUser(role: string, deletedAt: Date | null = null) {
  const token = uniqueTestToken("kaa");
  const [u] = await db
    .insert(users)
    .values({ username: token, email: `${token}@test.local`, password: "x", name: "TEST kaa", role, deletedAt } as any)
    .returning();
  created.push(u.id);
  return u;
}

/** Exécute `body` dans une transaction où seuls les administrateurs `keep` restent actifs, puis annule. */
async function withOnlyAdmins(keep: number[], body: (tx: any) => Promise<void>) {
  class Rollback extends Error {}
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.execute(sql`UPDATE users SET deleted_at = now() WHERE role = 'admin' AND deleted_at IS NULL AND id NOT IN (${sql.join(keep.map((k) => sql`${k}`), sql`, `)})`);
      await tx.execute(sql`SET LOCAL session_replication_role = origin`);
      await body(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

async function refused(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (e) {
    return isLastActiveAdminViolation((e as any).cause ?? e);
  }
  return false;
}

beforeAll(async () => {
  await db.execute(sql.raw(USERS_KEEP_ACTIVE_ADMIN_SQL));
}, 60_000);

afterAll(async () => {
  if (created.length) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.delete(users).where(inArray(users.id, created));
    });
  }
}, 60_000);

describe("trigger users_keep_one_active_admin", { timeout: 60_000 }, () => {
  it("dernier administrateur actif : suppression, rétrogradation et désactivation refusées", async () => {
    const admin = await makeUser("admin");
    await withOnlyAdmins([admin.id], async (tx) => {
      expect(await refused(() => tx.execute(sql`SAVEPOINT a`).then(() => tx.execute(sql`DELETE FROM users WHERE id = ${admin.id}`)))).toBe(true);
      await tx.execute(sql`ROLLBACK TO SAVEPOINT a`);
      expect(await refused(() => tx.execute(sql`UPDATE users SET role = 'driver' WHERE id = ${admin.id}`))).toBe(true);
      await tx.execute(sql`ROLLBACK TO SAVEPOINT a`);
      expect(await refused(() => tx.execute(sql`UPDATE users SET deleted_at = now() WHERE id = ${admin.id}`))).toBe(true);
    });
  });

  it("un autre administrateur actif existe : la sortie de l'un est permise", async () => {
    const [a, b] = [await makeUser("admin"), await makeUser("admin")];
    await withOnlyAdmins([a.id, b.id], async (tx) => {
      await tx.execute(sql`UPDATE users SET role = 'driver' WHERE id = ${a.id}`);
      const [row] = (await tx.execute(sql`SELECT role FROM users WHERE id = ${a.id}`)).rows as any[];
      expect(row.role).toBe("driver");
    });
  });

  it("un administrateur déjà désactivé ne compte pas ; un non-administrateur est libre", async () => {
    const lone = await makeUser("admin");
    const ghost = await makeUser("admin", new Date());
    const other = await makeUser("driver");
    await withOnlyAdmins([lone.id], async (tx) => {
      await tx.execute(sql`DELETE FROM users WHERE id = ${other.id}`);
      expect(await refused(() => tx.execute(sql`UPDATE users SET deleted_at = now() WHERE id = ${lone.id}`))).toBe(true);
    });
    expect(ghost.id).toBeGreaterThan(0);
  });

  it("le SQL est rejouable sans erreur", async () => {
    await db.execute(sql.raw(USERS_KEEP_ACTIVE_ADMIN_SQL));
    const [row] = (await db.execute(sql`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'trg_users_keep_active_admin' AND NOT tgisinternal`)).rows as any[];
    expect(row.n).toBe(1);
  });

  it("mise à jour et suppression en masse des administrateurs : refusées", async () => {
    const [a, b] = [await makeUser("admin"), await makeUser("admin")];
    await withOnlyAdmins([a.id, b.id], async (tx) => {
      await tx.execute(sql`SAVEPOINT m`);
      expect(await refused(() => tx.execute(sql`UPDATE users SET deleted_at = now() WHERE role = 'admin'`))).toBe(true);
      await tx.execute(sql`ROLLBACK TO SAVEPOINT m`);
      expect(await refused(() => tx.execute(sql`UPDATE users SET role = 'driver' WHERE role = 'admin'`))).toBe(true);
      await tx.execute(sql`ROLLBACK TO SAVEPOINT m`);
      expect(await refused(() => tx.execute(sql`DELETE FROM users WHERE role = 'admin'`))).toBe(true);
    });
  });
});

describe("isolation REPEATABLE READ couverte", { timeout: 60_000 }, () => {
  it("deux connexions dédiées, deux administrateurs : au moins une sortie échoue", async () => {
    const [a, b] = [await makeUser("admin"), await makeUser("admin")];
    const others = (await db.execute(sql`SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL AND id NOT IN (${a.id}, ${b.id})`)).rows.map((r: any) => r.id as number);
    const setOthers = async (value: "now()" | "NULL") => {
      if (!others.length) return;
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL session_replication_role = replica`);
        await tx.execute(sql`UPDATE users SET deleted_at = ${sql.raw(value)} WHERE id IN (${sql.join(others.map((i) => sql`${i}`), sql`, `)})`);
      });
    };
    await setOthers("now()");
    const [c1, c2] = [await pool.connect(), await pool.connect()];
    try {
      for (const c of [c1, c2]) {
        await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await c.query("SELECT count(*) FROM users"); // fige l'instantané
      }
      const run = (c: typeof c1, id: number) =>
        c.query("UPDATE users SET deleted_at = now() WHERE id = $1", [id]).then(
          () => c.query("COMMIT").then(() => true),
          () => c.query("ROLLBACK").then(() => false),
        );
      const results = await Promise.all([run(c1, a.id), run(c2, b.id)]);
      expect(results.filter(Boolean).length).toBeLessThan(2);
      const [row] = (await db.execute(sql`SELECT count(*)::int AS n FROM users WHERE id IN (${a.id}, ${b.id}) AND deleted_at IS NULL`)).rows as any[];
      expect(row.n).toBeGreaterThanOrEqual(1);
    } finally {
      c1.release();
      c2.release();
      await setOthers("NULL");
    }
  });
});
