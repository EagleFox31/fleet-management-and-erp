import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { partRequirements, parts, partSpecifications, partVariants, users } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestPart, createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Reliquat de la lecture stricte des identifiants de route (suite de #360, remplace la pile #365 à #375).
 * - Fiche pièce, spécifications, variantes : sans contrainte `([0-9]+)` dans le chemin, `<id>abc` atteint le
 *   handler et répond 400 avec son message, au lieu d'un 404 sans message.
 * - Garde du toggle admin : `<id>abc` répond 400 avant `server/routes.ts`, qui lit l'id de façon lâche et
 *   aurait activé ou désactivé le compte `<id>`. Désactivation d'un autre compte : `last-admin-guard` refusait déjà
 *   (non-régression). Réactivation d'un autre compte : rien ne la gardait. Son propre compte : la réponse portait
 *   sur l'auto-désactivation au lieu de l'id invalide.
 * - Demandes de pièce : `<id>abc` répond 400, la demande `<id>` reste intacte.
 * Chaque cas vise un id existant suivi de lettres : `parseInt` y lirait cet id.
 */

const ACTORS = { admin: "admin", warehouse: "warehouse" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const requirementIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let partId = 0;
let partName = "";
let partQuantity = 0;
let specId = 0;
let variantId = 0;
let requirementId = 0;
let otherUserId = 0;
let deactivatedUserId = 0;

const call = (actor: Actor, method: string, path: string, body?: unknown) => session.call(method, path, { actor, body });

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const part = await createTestPart({ quantity: 5 });
  ids.partIds.push(part.id);
  partId = part.id;
  partName = part.name;
  partQuantity = part.quantity;

  const spec = await call("warehouse", "POST", `/api/parts/${partId}/specifications`, {
    specificationName: uniqueTestToken("Diamètre"),
    specificationValue: "10",
  });
  expect(spec.status).toBe(201);
  specId = spec.body.id;
  const variant = await call("warehouse", "POST", `/api/parts/${partId}/variants`, {
    variantName: "TEST variante",
    variantCode: uniqueTestToken("var"),
    additionalPrice: 250,
  });
  expect(variant.status).toBe(201);
  variantId = variant.body.id;

  const [requirement] = await db
    .insert(partRequirements)
    .values({ partId, quantityNeeded: 1, reason: "TEST reliquat id strict", status: "pending", requestedBy: session.userIdOf("warehouse") })
    .returning();
  requirementIds.push(requirement.id);
  requirementId = requirement.id;

  const other = await createTestUser({ role: "technician" });
  ids.userIds.push(other.id);
  otherUserId = other.id;

  const deactivated = await createTestUser({ role: "technician" });
  ids.userIds.push(deactivated.id);
  await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deactivated.id));
  deactivatedUserId = deactivated.id;
}, 120000);

afterAll(async () => {
  if (requirementIds.length > 0) await db.delete(partRequirements).where(inArray(partRequirements.id, requirementIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

const partRow = async () => (await db.select().from(parts).where(eq(parts.id, partId)))[0];

describe("fiche pièce : <id>abc répond 400 et ne touche pas la pièce <id>", { timeout: 60000 }, () => {
  it.each([
    ["PATCH", "admin", "", { name: "TEST renommée" }],
    ["DELETE", "admin", "", undefined],
    ["POST", "warehouse", "/update-stock", { adjustment: 3, reason: "TEST" }],
  ] as const)("%s /api/parts/<id>abc%s", async (method, actor, suffix, body) => {
    const res = await call(actor, method, `/api/parts/${partId}abc${suffix}`, body);
    expect(res.status).toBe(400);
    expect(res.body?.message).toBe("ID de pièce invalide");
    const row = await partRow();
    expect(row).toBeDefined();
    expect(row.name).toBe(partName);
    expect(row.quantity).toBe(partQuantity);
  });
});

describe("spécifications et variantes : <id>abc répond 400 avec le message de l'identifiant fautif", { timeout: 60000 }, () => {
  it.each([
    ["GET", "/specifications", undefined],
    ["POST", "/specifications", { specificationName: "TEST x", specificationValue: "1" }],
    ["GET", "/variants", undefined],
    ["POST", "/variants", { variantName: "TEST x", variantCode: "TEST-x", additionalPrice: 0 }],
  ] as const)("%s /api/parts/<id>abc%s : pièce invalide", async (method, suffix, body) => {
    const res = await call("warehouse", method, `/api/parts/${partId}abc${suffix}`, body);
    expect(res.status).toBe(400);
    expect(res.body?.message).toBe("Identifiant de pièce invalide");
  });

  it("PATCH et DELETE d'une spécification <specId>abc : 400, spécification intacte", async () => {
    const before = (await db.select().from(partSpecifications).where(eq(partSpecifications.id, specId)))[0];
    for (const [method, body] of [["PATCH", { specificationValue: "99" }], ["DELETE", undefined]] as const) {
      const res = await call("warehouse", method, `/api/parts/${partId}/specifications/${specId}abc`, body);
      expect(res.status).toBe(400);
      expect(res.body?.message).toBe("Identifiant de spécification invalide");
    }
    const after = (await db.select().from(partSpecifications).where(eq(partSpecifications.id, specId)))[0];
    expect(after).toEqual(before);
  });

  it("PATCH et DELETE d'une variante <variantId>abc : 400, variante intacte", async () => {
    const before = (await db.select().from(partVariants).where(eq(partVariants.id, variantId)))[0];
    for (const [method, body] of [["PATCH", { additionalPrice: 999 }], ["DELETE", undefined]] as const) {
      const res = await call("warehouse", method, `/api/parts/${partId}/variants/${variantId}abc`, body);
      expect(res.status).toBe(400);
      expect(res.body?.message).toBe("Identifiant de variante invalide");
    }
    const after = (await db.select().from(partVariants).where(eq(partVariants.id, variantId)))[0];
    expect(after).toEqual(before);
  });
});

describe("toggle admin : <id>abc répond 400 avant la route gelée", { timeout: 60000 }, () => {
  it("compte d'un autre : 400, le compte reste actif", async () => {
    const res = await call("admin", "PATCH", `/api/admin/users/${otherUserId}abc/toggle`, { isActive: false });
    expect(res.status).toBe(400);
    expect(res.body?.message).toBe("Identifiant d'utilisateur invalide.");
    // La désactivation est une suppression douce : `deletedAt` renseigné.
    const [row] = await db.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, otherUserId));
    expect(row.deletedAt).toBeNull();
  });

  it("réactivation d'un autre compte désactivé : 400, le compte reste désactivé", async () => {
    const res = await call("admin", "PATCH", `/api/admin/users/${deactivatedUserId}abc/toggle`, { isActive: true });
    expect(res.status).toBe(400);
    expect(res.body?.message).toBe("Identifiant d'utilisateur invalide.");
    const [row] = await db.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, deactivatedUserId));
    expect(row.deletedAt).not.toBeNull();
  });

  it("son propre compte : 400 sur l'identifiant, pas sur l'auto-désactivation", async () => {
    const adminId = session.userIdOf("admin");
    const res = await call("admin", "PATCH", `/api/admin/users/${adminId}abc/toggle`, { isActive: false });
    expect(res.status).toBe(400);
    expect(res.body?.message).toBe("Identifiant d'utilisateur invalide.");
  });
});

describe("demandes de pièce : <id>abc répond 400, la demande <id> reste intacte", { timeout: 60000 }, () => {
  it.each([
    ["PATCH", { notes: "TEST modifiée" }],
    ["DELETE", undefined],
  ] as const)("%s /api/part-requirements/<id>abc", async (method, body) => {
    const before = (await db.select().from(partRequirements).where(eq(partRequirements.id, requirementId)))[0];
    const res = await call("admin", method, `/api/part-requirements/${requirementId}abc`, body);
    expect(res.status).toBe(400);
    expect(res.body?.message).toBe("ID de demande invalide");
    const after = (await db.select().from(partRequirements).where(eq(partRequirements.id, requirementId)))[0];
    expect(after).toEqual(before);
  });

  it("GET /api/part-requirements/by-part/<id>abc : 400", async () => {
    const res = await call("warehouse", "GET", `/api/part-requirements/by-part/${partId}abc`);
    expect(res.status).toBe(400);
    expect(res.body?.message).toBe("ID de pièce invalide");
  });
});
