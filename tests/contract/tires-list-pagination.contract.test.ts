import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { inArray } from "drizzle-orm";
import { tires } from "../../shared/schema";
import { getDefaultTireFormValues } from "../../shared/tire-form";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { uniqueTestToken } from "../support/ids";
import { fetchAllPages, type FetchLike } from "../../client/src/lib/fetch-all-pages";

/**
 * L'inventaire des pneus lit désormais toutes les pages de `GET /api/tires` (20 par défaut sans
 * `limit`). La lecture page par page exige un `total` numérique : servi en texte (`count(*)`
 * Postgres), elle refusait la liste entière.
 */
const ACTORS = { warehouse: "warehouse" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const tireIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const model = uniqueTestToken("tpg");

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  for (let i = 0; i < 3; i++) {
    const res = await session.call("POST", "/api/tires", {
      actor: "warehouse",
      body: {
        ...getDefaultTireFormValues(),
        brand: "TEST",
        model,
        manufacturingWeek: "10",
        stockQuantity: 1,
        purchasePrice: 1000,
        supplier: "TEST",
        location: "TEST",
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    tireIds.push(res.body.id);
  }
}, 120000);

afterAll(async () => {
  if (tireIds.length > 0) await db.delete(tires).where(inArray(tires.id, tireIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

// `?search=` n'est pas utilisable ici : la route le compare à la marque ET au modèle ET à la
// dimension. La lecture porte donc sur tout le stock de la base de test.
let total = 0;

describe("GET /api/tires : lecture complète page par page", { timeout: 120000 }, () => {
  it("total numérique, défaut de 20 lignes sans `limit`", async () => {
    const res = await session.call("GET", "/api/tires", { actor: "warehouse" });
    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe("number");
    total = res.body.total;
    expect(total).toBeGreaterThanOrEqual(3);
    expect(res.body.tires.length).toBe(Math.min(total, 20));
  });

  it("au moins deux pages : tout le stock, sans doublon ni manque, nos 3 pneus compris", async () => {
    const fetchFn: FetchLike = async (url) => {
      const res = await session.call("GET", url, { actor: "warehouse" });
      return { ok: res.status < 400, status: res.status, json: async () => res.body };
    };
    const rows = await fetchAllPages<{ id: number }>(fetchFn, {
      path: "/api/tires",
      listKey: "tires",
      pageSize: Math.ceil(total / 2),
      unreadable: "illisible",
      tooMany: () => "trop",
    });
    expect(rows).toHaveLength(total);
    const seen = new Set(rows.map((r) => r.id));
    for (const id of tireIds) expect(seen.has(id)).toBe(true);
  });
});
