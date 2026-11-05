import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { users } from "../../shared/schema";
import { apiErrorProblems } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestUser } from "../support/factories";

/**
 * Garde « un admin ne se désactive pas lui-même » : elle lit l'id comme la route qu'elle protège.
 * Avant, la garde lisait `parseInt(id, 10)` et la route `parseInt(id)` : « 0x<hex de mon id> » passait la
 * garde (lu 0) et désactivait le compte de l'admin (lu comme son id). Désormais tout id illisible est refusé.
 */
const ACTORS = { admin: "admin" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let adminId = 0;

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  adminId = session.userIdOf("admin");
}, 120000);

afterAll(async () => {
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

/** Actif = pas de suppression logique (la route aval pose `deletedAt` pour désactiver). */
const isActive = async (id: number) => (await db.select({ d: users.deletedAt }).from(users).where(eq(users.id, id)))[0]?.d === null;
const toggle = (id: string, active: boolean) => session.call("PATCH", `/api/admin/users/${id}/toggle`, { actor: "admin", body: { isActive: active } });

describe("garde d'auto-désactivation : identifiant strict", { timeout: 60000 }, () => {
  it("son propre id en clair : 400 et le compte reste actif", async () => {
    const res = await toggle(String(adminId), false);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(await isActive(adminId)).toBe(true);
  });

  it("son propre id déguisé (0x…, suffixe, exposant) : 400 et le compte reste actif", async () => {
    for (const disguised of [`0x${adminId.toString(16)}`, `${adminId}abc`, `${adminId}e0`, `+${adminId}`, `0${adminId}x`]) {
      const res = await toggle(encodeURIComponent(disguised), false);
      expect(apiErrorProblems(res.status, res.body, 400, "VALIDATION", res.headers.get("x-request-id")), `${disguised} -> ${res.status} ${JSON.stringify(res.body)}`).toEqual([]);
      expect(await isActive(adminId), disguised).toBe(true);
    }
  });

  it("non-régression : un autre utilisateur se désactive puis se réactive", async () => {
    const other = await createTestUser({ role: "technician" });
    ids.userIds.push(other.id);
    const off = await toggle(String(other.id), false);
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(await isActive(other.id)).toBe(false);
    const on = await toggle(String(other.id), true);
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(await isActive(other.id)).toBe(true);
  });
});
