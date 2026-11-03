import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { faultCatalog, faultCatalogParts, partRequirements, parts } from "../../shared/schema";
import { apiErrorProblems } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestPart } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, PRT1 (complément) : accès, forme des erreurs et suppression d'une pièce référencée.
 * La « catégorie » d'une pièce est un texte libre de la fiche (`parts.category`), sans entité ni route
 * propre : son CRUD est la création et la modification de la pièce (voir parts-catalog-crud).
 * - 401 anonyme sur toute écriture, 403 client et rôles non autorisés ;
 * - toute erreur suit `ApiErrorBody` (shared/errors.ts) : message français, code, aucun détail technique ;
 * - double soumission concurrente : une seule création ;
 * - pièce citée par le catalogue de pannes ou par une demande : refus lisible, jamais 500.
 */

const ACTORS = {
  admin: "admin",
  warehouse: "warehouse",
  technician: "technician",
  client: "client",
} as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);

const partBody = (overrides: Record<string, unknown> = {}) => ({
  name: "TEST pièce accès",
  reference: uniqueTestToken("acc"),
  category: "Filtres",
  quantity: 10,
  minQuantity: 5,
  unitPrice: "1500",
  ...overrides,
});

async function newPartId(): Promise<number> {
  const part = await createTestPart();
  ids.partIds.push(part.id);
  return part.id;
}

const rowOf = async (id: number) => (await db.select().from(parts).where(eq(parts.id, id)))[0];

/** Corps d'erreur conforme à ApiErrorBody (tests/support/api-error.ts, même contrôle que les e2e). */
function expectApiError(res: { status: number; body: unknown; headers: Headers }, status: number, code: string) {
  expect(apiErrorProblems(res.status, res.body, status, code, res.headers.get("x-request-id"))).toEqual([]);
}

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("PRT1 : écritures sans session ou hors rôle", { timeout: 60000 }, () => {
  it("anonyme : 401 ApiErrorBody sur POST, PATCH, DELETE et sur les enfants, rien n'est écrit", async () => {
    const partId = await newPartId();
    const before = await rowOf(partId);
    const created = partBody();
    const attempts: Array<[string, string, unknown]> = [
      ["POST", "/api/parts", created],
      ["PATCH", `/api/parts/${partId}`, { category: "Pirate" }],
      ["DELETE", `/api/parts/${partId}`, undefined],
      ["POST", `/api/parts/${partId}/specifications`, { specificationName: "a", specificationValue: "b" }],
      ["POST", `/api/parts/${partId}/variants`, { variantName: "v", variantCode: uniqueTestToken("v"), additionalPrice: 1 }],
      ["GET", `/api/parts/${partId}/variants`, undefined],
      ["GET", `/api/parts/${partId}/specifications`, undefined],
    ];
    for (const [method, path, body] of attempts) {
      const res = await call(method, path, { body });
      expectApiError(res, 401, "UNAUTHENTICATED");
    }
    expect(await db.select().from(parts).where(eq(parts.reference, created.reference))).toHaveLength(0);
    const after = await rowOf(partId);
    expect(after.category).toBe(before.category);
  });

  it("client : 403 ApiErrorBody sur création, modification et suppression ; la fiche reste intacte", async () => {
    const partId = await newPartId();
    const before = await rowOf(partId);
    const body = partBody();
    expectApiError(await call("POST", "/api/parts", { actor: "client", body }), 403, "FORBIDDEN");
    expect(await db.select().from(parts).where(eq(parts.reference, body.reference))).toHaveLength(0);
    expectApiError(await call("PATCH", `/api/parts/${partId}`, { actor: "client", body: { category: "Pirate" } }), 403, "FORBIDDEN");
    expectApiError(await call("DELETE", `/api/parts/${partId}`, { actor: "client" }), 403, "FORBIDDEN");
    const after = await rowOf(partId);
    expect(after.category).toBe(before.category);
    expect(after.updatedBy).toBe(before.updatedBy);
  });

  it("technicien : 403 ApiErrorBody sur modification ; magasinier : 403 sur suppression", async () => {
    const partId = await newPartId();
    expectApiError(await call("PATCH", `/api/parts/${partId}`, { actor: "technician", body: { name: "X" } }), 403, "FORBIDDEN");
    expectApiError(await call("DELETE", `/api/parts/${partId}`, { actor: "warehouse" }), 403, "FORBIDDEN");
    expect(await rowOf(partId)).toBeDefined();
  });
});

describe("PRT1 : forme des erreurs (ApiErrorBody)", { timeout: 60000 }, () => {
  it("400 : corps vide, prix invalide et stock négatif à la création", async () => {
    for (const body of [{}, partBody({ unitPrice: "beaucoup" }), partBody({ quantity: -1 })]) {
      expectApiError(await call("POST", "/api/parts", { actor: "admin", body }), 400, "VALIDATION");
    }
  });

  it("404 : pièce inconnue en lecture, modification et suppression", async () => {
    expectApiError(await call("GET", "/api/parts/2147483000", { actor: "admin" }), 404, "NOT_FOUND");
    expectApiError(await call("PATCH", "/api/parts/2147483000", { actor: "admin", body: { category: "Z" } }), 404, "NOT_FOUND");
    expectApiError(await call("DELETE", "/api/parts/2147483000", { actor: "admin" }), 404, "NOT_FOUND");
  });

  it("409 : référence déjà prise, à la création comme à la modification", async () => {
    const first = await call("POST", "/api/parts", { actor: "admin", body: partBody() });
    expect(first.status).toBe(201);
    ids.partIds.push(first.body.id);
    expectApiError(await call("POST", "/api/parts", { actor: "admin", body: partBody({ reference: first.body.reference }) }), 409, "CONFLICT");
    const otherId = await newPartId();
    expectApiError(await call("PATCH", `/api/parts/${otherId}`, { actor: "admin", body: { reference: first.body.reference } }), 409, "CONFLICT");
  });

  it("modification : prix non numérique et stock mal typé refusés en 400, la fiche ne bouge pas", async () => {
    const partId = await newPartId();
    const before = await rowOf(partId);
    for (const body of [{ unitPrice: "beaucoup" }, { quantity: "dix" }]) {
      const res = await call("PATCH", `/api/parts/${partId}`, { actor: "warehouse", body });
      expectApiError(res, 400, "VALIDATION");
    }
    const after = await rowOf(partId);
    expect(after.unitPrice).toBe(before.unitPrice);
    expect(after.quantity).toBe(before.quantity);
  });

  // Le PATCH applique les bornes de `insertPartSchema` (stock et seuil >= 0), comme la création.
  let negativeStockPartId = 0;
  beforeAll(async () => {
    negativeStockPartId = await newPartId();
  });

  it("témoin : la pièce du test de stock négatif existe et a un stock positif", async () => {
    expect((await rowOf(negativeStockPartId)).quantity).toBeGreaterThanOrEqual(0);
  });

  it("modification : stock négatif refusé en 400, la fiche ne bouge pas", async () => {
    const res = await call("PATCH", `/api/parts/${negativeStockPartId}`, { actor: "warehouse", body: { quantity: -3 } });
    expectApiError(res, 400, "VALIDATION");
    expect((await rowOf(negativeStockPartId)).quantity).toBeGreaterThanOrEqual(0);
  });

  // Le statut seul : aucune route `/api` inconnue n'a de gestionnaire, le 404 d'Express sort hors ApiErrorBody (backlog).
  it("identifiant non numérique : aucune route ne répond, statut 404 exact", async () => {
    expect((await call("GET", "/api/parts/abc", { actor: "admin" })).status).toBe(404);
  });
});

describe("PRT1 : double soumission", { timeout: 60000 }, () => {
  it("deux créations simultanées de la même référence : une seule fiche, l'autre 409", async () => {
    const body = partBody();
    const [a, b] = await Promise.all([
      call("POST", "/api/parts", { actor: "warehouse", body }),
      call("POST", "/api/parts", { actor: "warehouse", body }),
    ]);
    const created = [a, b].filter((r) => r.status === 201);
    for (const r of created) ids.partIds.push(r.body.id);
    expect(created).toHaveLength(1);
    const refused = [a, b].find((r) => r.status !== 201)!;
    expectApiError(refused, 409, "CONFLICT");
    expect(await db.select().from(parts).where(eq(parts.reference, body.reference))).toHaveLength(1);
  });
});

describe("PRT1 : suppression d'une pièce référencée", { timeout: 60000 }, () => {
  it("citée par le catalogue de pannes : 409 lisible, pièce intacte", async () => {
    const partId = await newPartId();
    const [fault] = await db
      .insert(faultCatalog)
      .values({ name: uniqueTestToken("panne"), description: "TEST", category: "Moteur" })
      .returning({ id: faultCatalog.id });
    await db.insert(faultCatalogParts).values({ faultCatalogId: fault.id, partId });
    try {
      expectApiError(await call("DELETE", `/api/parts/${partId}`, { actor: "admin" }), 409, "CONFLICT");
      expect(await rowOf(partId)).toBeDefined();
    } finally {
      await db.delete(faultCatalog).where(eq(faultCatalog.id, fault.id));
    }
  });

  // Une pièce citée par `part_requirements` (FK sans cascade) : `deletePart` refuse en 409 avant toute écriture.
  let referencedPartId = 0;
  let requirementId = 0;
  beforeAll(async () => {
    referencedPartId = await newPartId();
    const [requirement] = await db
      .insert(partRequirements)
      .values({ partId: referencedPartId, quantityNeeded: 1, reason: "TEST suppression" })
      .returning({ id: partRequirements.id });
    requirementId = requirement.id;
  });
  afterAll(async () => {
    if (requirementId) await db.delete(partRequirements).where(eq(partRequirements.id, requirementId));
  });

  it("témoin : la demande de pièce référence bien la pièce", async () => {
    const [row] = await db.select().from(partRequirements).where(eq(partRequirements.id, requirementId));
    expect(row.partId).toBe(referencedPartId);
  });

  it("citée par une demande de pièce : 409 lisible, jamais 500 ni texte d'exception", async () => {
    const res = await call("DELETE", `/api/parts/${referencedPartId}`, { actor: "admin" });
    expectApiError(res, 409, "CONFLICT");
    expect(await rowOf(referencedPartId)).toBeDefined();
  });
});
