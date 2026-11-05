import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { inArray } from "drizzle-orm";
import { tires } from "../../shared/schema";
import { getDefaultTireFormValues } from "../../shared/tire-form";
import { normalizeScope, resolveRecipients } from "../../server/lib/realtime-scope";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { uniqueTestToken } from "../support/ids";

/**
 * Prix d'achat des pneus : le chauffeur lit la fiche sans le prix, ne reçoit pas les trames `tire_*`
 * et n'accède pas à la valeur d'inventaire ; le magasinier voit tout.
 */
const ACTORS = { admin: "admin", warehouse: "warehouse", driver: "driver", client: "client" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const tireIds: number[] = [];
const frames: { eventType: string; scope?: unknown }[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let tireId = 0;
const model = uniqueTestToken("tpr");

const reaches = (scope: unknown, actor: Actor): boolean =>
  resolveRecipients(normalizeScope(scope, null), {
    byUser: new Map([[session.userIdOf(actor), new Set(["s"])]]),
    byRole: new Map([[ACTORS[actor], new Set(["s"])]]),
  }).size > 0;

const hasPrice = (value: unknown): boolean => JSON.stringify(value).includes('"purchasePrice"');

beforeAll(async () => {
  (global as any).broadcastUpdate = (eventType: string, data: any) => {
    frames.push({ eventType, scope: data?.scope });
  };
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const res = await session.call("POST", "/api/tires", {
    actor: "warehouse",
    body: {
      ...getDefaultTireFormValues(),
      brand: "TEST",
      model,
      manufacturingWeek: "10",
      stockQuantity: 1,
      purchasePrice: 123456,
      supplier: "TEST",
      location: "TEST",
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  tireId = res.body.id;
  tireIds.push(tireId);
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (tireIds.length > 0) await db.delete(tires).where(inArray(tires.id, tireIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("prix d'achat des pneus", { timeout: 120000 }, () => {
  it("fiche et liste : prix visible du magasinier, absent pour le chauffeur qui garde la lecture", async () => {
    const detailW = await session.call("GET", `/api/tires/${tireId}`, { actor: "warehouse" });
    expect(detailW.status).toBe(200);
    expect(hasPrice(detailW.body)).toBe(true);
    const detailD = await session.call("GET", `/api/tires/${tireId}`, { actor: "driver" });
    expect(detailD.status).toBe(200);
    expect(detailD.body.id).toBe(tireId);
    expect(hasPrice(detailD.body)).toBe(false);

    const listW = await session.call("GET", `/api/tires?limit=200`, { actor: "warehouse" });
    expect(hasPrice(listW.body)).toBe(true);
    const listD = await session.call("GET", `/api/tires?limit=200`, { actor: "driver" });
    expect(listD.status).toBe(200);
    expect(JSON.stringify(listD.body)).toContain("brand");
    expect(hasPrice(listD.body)).toBe(false);

    const low = await session.call("GET", "/api/tires/low-stock", { actor: "driver" });
    expect(low.status).toBe(200);
    expect(hasPrice(low.body)).toBe(false);
  });

  it("valeur d'inventaire : refusée au chauffeur, servie au magasinier", async () => {
    for (const path of ["/api/tires/statistics", "/api/tires/statistics-advanced"]) {
      expect((await session.call("GET", path, { actor: "driver" })).status, path).toBe(403);
      expect((await session.call("GET", path, { actor: "warehouse" })).status, path).toBe(200);
    }
  });

  it("trames tire_* : jamais au chauffeur ni au client, au magasin oui", () => {
    const tireFrames = frames.filter((f) => f.eventType.startsWith("tire_"));
    expect(tireFrames.length).toBeGreaterThan(0);
    for (const actor of ["driver", "client"] as Actor[]) {
      expect(tireFrames.some((f) => reaches(f.scope, actor)), actor).toBe(false);
    }
    for (const actor of ["admin", "warehouse"] as Actor[]) {
      expect(tireFrames.some((f) => reaches(f.scope, actor)), actor).toBe(true);
    }
  });
});
