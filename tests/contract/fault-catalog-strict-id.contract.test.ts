import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { faultCatalog, faultCatalogParts } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestPart } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Pièces d'une panne du catalogue : sans contrainte `([0-9]+)` dans le chemin, `<id>abc` atteint le
 * handler et répond 400 avec le message de l'identifiant fautif, au lieu d'un 404 sans message.
 * Chaque cas vise un id existant suivi de lettres : `parseInt` y lirait cet id. Le lien reste intact.
 */

const ACTORS = { workshopManager: "workshop_manager" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const catalogIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let faultId = 0;
let linkId = 0;

const call = (method: string, path: string, body?: unknown) => session.call(method, path, { actor: "workshopManager", body });
const linkRow = async () => (await db.select().from(faultCatalogParts).where(eq(faultCatalogParts.id, linkId)))[0];

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const fault = await call("POST", "/api/fault-catalog", {
    name: uniqueTestToken("panne"),
    description: "TEST description",
    category: "Moteur",
    symptoms: ["bruit"],
  });
  expect(fault.status).toBe(201);
  faultId = fault.body.id;
  catalogIds.push(faultId);
  const part = await createTestPart();
  ids.partIds.push(part.id);
  const link = await call("POST", `/api/fault-catalog/${faultId}/parts`, { partId: part.id });
  expect(link.status).toBe(201);
  linkId = link.body.id;
}, 120000);

afterAll(async () => {
  if (catalogIds.length > 0) await db.delete(faultCatalog).where(inArray(faultCatalog.id, catalogIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("pièces d'une panne : <id>abc répond 400 avec son message", { timeout: 60000 }, () => {
  it.each([
    ["GET", undefined],
    ["POST", { partId: 1 }],
  ] as const)("%s /api/fault-catalog/<id>abc/parts : panne invalide", async (method, body) => {
    const res = await call(method, `/api/fault-catalog/${faultId}abc/parts`, body);
    expect(res.status).toBe(400);
    expect(res.body?.message).toBe("Identifiant de panne invalide");
  });

  it.each([
    ["PATCH", { quantity: 9 }],
    ["DELETE", undefined],
  ] as const)("%s /api/fault-catalog/<id>/parts/<linkId>abc : lien invalide, lien intact", async (method, body) => {
    const before = await linkRow();
    const res = await call(method, `/api/fault-catalog/${faultId}/parts/${linkId}abc`, body);
    expect(res.status).toBe(400);
    expect(res.body?.message).toBe("Identifiant de lien invalide");
    expect(await linkRow()).toEqual(before);
  });

  it.each([
    ["PATCH", { quantity: 9 }],
    ["DELETE", undefined],
  ] as const)("%s /api/fault-catalog/<id>abc/parts/<linkId> : panne invalide, lien intact", async (method, body) => {
    const before = await linkRow();
    const res = await call(method, `/api/fault-catalog/${faultId}abc/parts/${linkId}`, body);
    expect(res.status).toBe(400);
    expect(res.body?.message).toBe("Identifiant de panne invalide");
    expect(await linkRow()).toEqual(before);
  });
});
