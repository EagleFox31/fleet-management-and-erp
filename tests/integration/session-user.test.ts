import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { findActiveSessionUser } from "../../server/services/session-user";
import { users } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";

/**
 * Relecture du compte de session (garde `authenticate`) : un compte supprimé n'est plus rendu,
 * un compte actif l'est. Le cas « base coupée → 500 » est couvert en unitaire
 * (tests/unit/server/auth-middleware.test.ts) : il ne se provoque pas sur une base partagée.
 */
const ids = createIdBag();
let activeId: number;
let deletedId: number;

beforeAll(async () => {
  activeId = (await createTestUser({ role: "technician" })).id;
  deletedId = (await createTestUser({ role: "technician" })).id;
  ids.userIds.push(activeId, deletedId);
  await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deletedId));
});

afterAll(async () => {
  await cleanupCreated(ids);
}, 120000);

describe("findActiveSessionUser", { timeout: 60000 }, () => {
  it("rend un compte actif", async () => {
    expect((await findActiveSessionUser(activeId))?.id).toBe(activeId);
  });

  it("ne rend pas un compte supprimé (deleted_at renseigné)", async () => {
    expect(await findActiveSessionUser(deletedId)).toBeUndefined();
  });

  it("ne rend rien pour un identifiant inconnu", async () => {
    expect(await findActiveSessionUser(-1)).toBeUndefined();
  });
});
