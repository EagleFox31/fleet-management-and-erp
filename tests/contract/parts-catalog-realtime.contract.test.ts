import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { uniqueTestToken } from "../support/ids";

/**
 * Couche 2 (AGENTS.md §2) du catalogue pièces : création, modification, ajustement de stock et
 * suppression d'une fiche émettent `part_catalog_changed`. Auparavant aucune trame ne partait :
 * les autres profils ne voyaient la fiche qu'au rechargement.
 * Portée (§11) : le personnel qui lit le stock, ni chauffeur ni client.
 *
 * Les trames sont capturées à `broadcastUpdate`, puis leur portée est résolue comme
 * `server/lib/realtime-scope.ts` (fermée par défaut : portée absente ou invalide = personne).
 */

type Scope = { type: string; userIds?: number[]; roles?: string[] };
type Captured = { eventType: string; scope?: Scope; payload?: Record<string, unknown>; entityId?: unknown };

const ACTORS = {
  admin: "admin",
  warehouse: "warehouse",
  technician: "technician",
  driver: "driver",
  client: "client",
} as const;
type Actor = keyof typeof ACTORS;

const reaches = (scope: Scope | undefined, actor: Actor): boolean => {
  if (!scope) return false;
  if (scope.type === "broadcast") return true;
  if (scope.type === "user") return (scope.userIds ?? []).includes(session.userIdOf(actor));
  if (scope.type === "roles") return (scope.roles ?? []).map((r) => r.trim().toLowerCase()).includes(ACTORS[actor]);
  return false;
};

const ids = createIdBag();
const captured: Captured[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

const frames = () => captured.filter((frame) => frame.eventType === "part_catalog_changed");

function expectStaffOnly(id: number, action: string) {
  const all = frames();
  expect(all).toHaveLength(1);
  expect(all[0].payload).toEqual({ id, action });
  expect(all[0].entityId).toBe(id);
  for (const actor of ["admin", "warehouse", "technician"] as const) expect(reaches(all[0].scope, actor)).toBe(true);
  for (const actor of ["driver", "client"] as const) expect(reaches(all[0].scope, actor)).toBe(false);
}

beforeAll(async () => {
  (global as any).broadcastUpdate = vi.fn((eventType: string, data: Omit<Captured, "eventType">) => {
    captured.push({ eventType, scope: data?.scope, payload: data?.payload, entityId: data?.entityId });
  });
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

async function createPart() {
  const res = await session.call("POST", "/api/parts", {
    actor: "warehouse",
    body: { name: "TEST pièce temps réel", reference: uniqueTestToken("rt"), category: "Filtres", quantity: 10, minQuantity: 5, unitPrice: "1500" },
  });
  expect(res.status).toBe(201);
  ids.partIds.push(res.body.id);
  return res.body.id as number;
}

describe("Catalogue pièces : trames temps réel (§2, §11)", { timeout: 120000 }, () => {
  it("création : une trame au personnel, ni chauffeur ni client", async () => {
    captured.length = 0;
    const id = await createPart();
    expectStaffOnly(id, "created");
  });

  it("modification : une trame au personnel", async () => {
    const id = await createPart();
    captured.length = 0;
    const res = await session.call("PATCH", `/api/parts/${id}`, { actor: "warehouse", body: { location: "TEST-RT1" } });
    expect(res.status).toBe(200);
    expectStaffOnly(id, "updated");
  });

  it("ajustement de stock : une trame au personnel", async () => {
    const id = await createPart();
    captured.length = 0;
    const res = await session.call("POST", `/api/parts/${id}/update-stock`, {
      actor: "warehouse",
      body: { adjustment: 3, reason: "TEST inventaire" },
    });
    expect(res.status).toBe(200);
    expectStaffOnly(id, "stock_adjusted");
  });

  it("suppression : une trame au personnel", async () => {
    const id = await createPart();
    captured.length = 0;
    const res = await session.call("DELETE", `/api/parts/${id}`, { actor: "admin" });
    expect(res.status).toBe(204);
    expectStaffOnly(id, "deleted");
  });

  it("écriture refusée ou invalide : aucune trame", async () => {
    const id = await createPart();
    captured.length = 0;
    expect((await session.call("PATCH", `/api/parts/${id}`, { actor: "technician", body: { location: "X" } })).status).toBe(403);
    expect((await session.call("PATCH", `/api/parts/${id}`, { actor: "warehouse", body: { unit: "tonneau" } })).status).toBe(400);
    expect((await session.call("POST", `/api/parts/${id}/update-stock`, { actor: "warehouse", body: { adjustment: 0, reason: "x" } })).status).toBe(400);
    expect(frames()).toEqual([]);
  });
});
