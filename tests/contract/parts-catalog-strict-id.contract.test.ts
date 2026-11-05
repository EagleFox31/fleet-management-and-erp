import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { parts } from "../../shared/schema";
import { apiErrorProblems } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestPart } from "../support/factories";

/**
 * Identifiant de pièce lu strictement (parseRouteId) sur PATCH, DELETE et update-stock du catalogue :
 * « 1abc » ne vise pas la pièce 1 mais reçoit un 400 lisible, un id inconnu un 404, rien n'est écrit.
 */
const ACTORS = { admin: "admin" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let partId = 0;

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const part = await createTestPart();
  ids.partIds.push(part.id);
  partId = part.id;
}, 120000);

afterAll(async () => {
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

const CALLS: Array<[string, (id: string) => string, unknown]> = [
  ["PATCH", (id) => `/api/parts/${id}`, { category: "Pirate" }],
  ["DELETE", (id) => `/api/parts/${id}`, undefined],
  ["POST", (id) => `/api/parts/${id}/update-stock`, { adjustment: 5, reason: "test" }],
];

describe("catalogue des pièces : identifiant strict", { timeout: 60000 }, () => {
  for (const [method, path, body] of CALLS) {
    it(`${method} ${path(":id")} : « <id>abc », « 1e3 » et un id hors int4 donnent 400, rien n'est écrit`, async () => {
      const before = (await db.select().from(parts).where(eq(parts.id, partId)))[0];
      for (const bad of [`${partId}abc`, "1e3", "2147483648", "0"]) {
        const res = await session.call(method, path(bad), { actor: "admin", body });
        expect(apiErrorProblems(res.status, res.body, 400, "VALIDATION", res.headers.get("x-request-id")), `${bad} -> ${res.status} ${JSON.stringify(res.body)}`).toEqual([]);
      }
      const after = (await db.select().from(parts).where(eq(parts.id, partId)))[0];
      expect(after).toEqual(before);
    });

    it(`${method} ${path(":id")} : id inconnu → 404`, async () => {
      const res = await session.call(method, path("2000000000"), { actor: "admin", body });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });
  }
});
