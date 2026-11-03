import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { partSpecifications, partVariants } from "../../shared/schema";
import { apiErrorProblems, leakText, TECHNICAL } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestPart } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, PRT1 : modification des variantes et spécifications d'une pièce, en complément de
 * `parts-catalog-crud` (création, lecture, suppression, rôles, enfant d'une autre pièce).
 *
 * Couvert par l'API seulement : `client/src/pages/inventory/parts-database.tsx`, le seul écran qui
 * affiche variantes et spécifications, n'est monté par aucune route de `App.tsx`.
 *
 * Cas : renommage sur un nom ou un code déjà pris (409, enfant intact), PATCH partiel qui ne remet
 * pas le supplément à 0 (piège de `.partial()` sur un champ à défaut), `partId` du corps ignoré
 * (pas de déplacement vers une autre pièce), texte vide 400, enfant inconnu 404.
 */

const ACTORS = { warehouse: "warehouse" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const patch = (path: string, body: unknown) => session.call("PATCH", path, { actor: "warehouse", body });
const post = (path: string, body: unknown) => session.call("POST", path, { actor: "warehouse", body });

async function newPartId(): Promise<number> {
  const part = await createTestPart();
  ids.partIds.push(part.id);
  return part.id;
}

const specRow = async (id: number) => (await db.select().from(partSpecifications).where(eq(partSpecifications.id, id)))[0];
const variantRow = async (id: number) => (await db.select().from(partVariants).where(eq(partVariants.id, id)))[0];
const noLeak = (body: unknown) => expect(leakText(body)).not.toMatch(TECHNICAL);

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("PRT1 : modification d'une spécification", { timeout: 60000 }, () => {
  it("renommer sur un nom déjà pris (casse ignorée) : 409 sans fuite, spécification intacte", async () => {
    const partId = await newPartId();
    const taken = uniqueTestToken("Diamètre");
    expect((await post(`/api/parts/${partId}/specifications`, { specificationName: taken, specificationValue: "1" })).status).toBe(201);
    const other = await post(`/api/parts/${partId}/specifications`, { specificationName: uniqueTestToken("Longueur"), specificationValue: "2" });
    expect(other.status).toBe(201);

    const res = await patch(`/api/parts/${partId}/specifications/${other.body.id}`, { specificationName: taken.toUpperCase() });
    expect(apiErrorProblems(res.status, res.body, 409)).toEqual([]);
    noLeak(res.body);
    expect((await specRow(other.body.id)).specificationName).toBe(other.body.specificationName);
  });

  it("partId du corps ignoré : la spécification reste sur sa pièce", async () => {
    const partId = await newPartId();
    const otherPartId = await newPartId();
    const spec = await post(`/api/parts/${partId}/specifications`, { specificationName: uniqueTestToken("Masse"), specificationValue: "3" });
    const res = await patch(`/api/parts/${partId}/specifications/${spec.body.id}`, { partId: otherPartId, specificationValue: "4" });
    expect(res.status).toBe(200);
    const row = await specRow(spec.body.id);
    expect(row.partId).toBe(partId);
    expect(row.specificationValue).toBe("4");
  });

  it("valeur vide : 400 lisible ; spécification inconnue : 404", async () => {
    const partId = await newPartId();
    const spec = await post(`/api/parts/${partId}/specifications`, { specificationName: uniqueTestToken("Pas"), specificationValue: "5" });
    const empty = await patch(`/api/parts/${partId}/specifications/${spec.body.id}`, { specificationValue: "   " });
    expect(apiErrorProblems(empty.status, empty.body, 400)).toEqual([]);
    noLeak(empty.body);
    expect((await specRow(spec.body.id)).specificationValue).toBe("5");
    const unknown = await patch(`/api/parts/${partId}/specifications/2147483000`, { specificationValue: "6" });
    expect(apiErrorProblems(unknown.status, unknown.body, 404)).toEqual([]);
  });
});

describe("PRT1 : modification d'une variante", { timeout: 60000 }, () => {
  const variant = (overrides: Record<string, unknown> = {}) => ({
    variantName: "TEST variante",
    variantCode: uniqueTestToken("var"),
    additionalPrice: 250,
    ...overrides,
  });

  it("PATCH partiel : le supplément n'est pas remis à 0", async () => {
    const partId = await newPartId();
    const created = await post(`/api/parts/${partId}/variants`, variant());
    expect(created.status).toBe(201);
    const res = await patch(`/api/parts/${partId}/variants/${created.body.id}`, { variantName: "TEST renommée" });
    expect(res.status).toBe(200);
    const row = await variantRow(created.body.id);
    expect(row.variantName).toBe("TEST renommée");
    expect(row.additionalPrice).toBe("250.00");
  });

  it("code déjà pris (y compris sur une autre pièce, unicité globale) : 409 sans fuite, variante intacte", async () => {
    const partId = await newPartId();
    const otherPartId = await newPartId();
    const taken = await post(`/api/parts/${otherPartId}/variants`, variant());
    const mine = await post(`/api/parts/${partId}/variants`, variant());
    const res = await patch(`/api/parts/${partId}/variants/${mine.body.id}`, { variantCode: taken.body.variantCode });
    expect(apiErrorProblems(res.status, res.body, 409)).toEqual([]);
    noLeak(res.body);
    expect((await variantRow(mine.body.id)).variantCode).toBe(mine.body.variantCode);
  });

  it("partId du corps ignoré ; supplément négatif : 400 lisible, variante intacte", async () => {
    const partId = await newPartId();
    const otherPartId = await newPartId();
    const created = await post(`/api/parts/${partId}/variants`, variant());
    const moved = await patch(`/api/parts/${partId}/variants/${created.body.id}`, { partId: otherPartId, isAvailable: false });
    expect(moved.status).toBe(200);
    expect((await variantRow(created.body.id)).partId).toBe(partId);

    const negative = await patch(`/api/parts/${partId}/variants/${created.body.id}`, { additionalPrice: -10 });
    expect(apiErrorProblems(negative.status, negative.body, 400)).toEqual([]);
    noLeak(negative.body);
    expect((await variantRow(created.body.id)).additionalPrice).toBe("250.00");
  });
});
