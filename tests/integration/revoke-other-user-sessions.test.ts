import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { closeOtherUserConnections, deleteOtherUserSessions } from "../../server/lib/user-sessions";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";

/**
 * revokeOtherUserSessions : efface les sessions du compte sauf celle gardée, ne touche pas les autres
 * comptes, ferme les sockets en excluant la session gardée, et le second appel n'efface plus rien.
 */
const ids = createIdBag();
let userId: number;
let otherId: number;
const tag = `TEST-rev-${Date.now().toString(36)}`;
const sid = (label: string) => `${tag}-${label}`;

async function insertSession(label: string, forUser: number) {
  await db.execute(
    sql`INSERT INTO "session" (sid, sess, expire) VALUES (${sid(label)}, ${JSON.stringify({ userId: forUser, cookie: {} })}::json, now() + interval '1 hour')`,
  );
}

async function remaining(): Promise<string[]> {
  const res = await db.execute(sql`SELECT sid FROM "session" WHERE sid LIKE ${tag + "-%"} ORDER BY sid`);
  return (res.rows as { sid: string }[]).map((r) => r.sid);
}

beforeAll(async () => {
  userId = (await createTestUser({ role: "technician" })).id;
  otherId = (await createTestUser({ role: "technician" })).id;
  ids.userIds.push(userId, otherId);
  await insertSession("keep", userId);
  await insertSession("old1", userId);
  await insertSession("old2", userId);
  await insertSession("other", otherId);
});

afterEach(() => {
  delete (global as { closeUserConnections?: unknown }).closeUserConnections;
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM "session" WHERE sid LIKE ${tag + "-%"}`);
  await cleanupCreated(ids);
}, 120000);

describe("revokeOtherUserSessions", { timeout: 60000 }, () => {
  it("efface les autres sessions du compte, garde la courante et celles d'un autre compte, ferme les sockets hors session gardée", async () => {
    const close = vi.fn();
    (global as { closeUserConnections?: unknown }).closeUserConnections = close;

    expect(await deleteOtherUserSessions(db, userId, sid("keep"))).toBe(2);
    expect(await remaining()).toEqual([sid("keep"), sid("other")]);
    expect(close, "les sockets ne sont fermées qu'après le commit").not.toHaveBeenCalled();
    closeOtherUserConnections(userId, sid("keep"), "password_changed");
    expect(close).toHaveBeenCalledWith(userId, "password_changed", sid("keep"));
  });

  it("transaction annulée : aucune session supprimée", async () => {
    await insertSession("tx", userId);
    await expect(
      db.transaction(async (tx) => {
        expect(await deleteOtherUserSessions(tx, userId, sid("keep"))).toBe(1);
        throw new Error("annulation");
      }),
    ).rejects.toThrow("annulation");
    expect(await remaining()).toContain(sid("tx"));
    await db.execute(sql`DELETE FROM "session" WHERE sid = ${sid("tx")}`);
  });

  it("second appel : 0 suppression (idempotent)", async () => {
    expect(await deleteOtherUserSessions(db, userId, sid("keep"))).toBe(0);
    expect(await remaining()).toEqual([sid("keep"), sid("other")]);
  });
});
