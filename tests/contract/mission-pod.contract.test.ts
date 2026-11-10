import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { uniqueTestToken } from "../support/ids";

/**
 * Preuve de livraison (POD). Faille d'origine : `insertMissionSchema` n'omettait pas `podUrl`
 * ni `podUploadedAt`, si bien que POST et PATCH /api/missions pouvaient écrire une fausse preuve.
 */

type Actor = "logistics";
const ids = createIdBag();
const missionIds: number[] = [];
let actors: Awaited<ReturnType<typeof startContractActors<Actor>>>;

beforeAll(async () => {
  actors = await startContractActors<Actor>({ logistics: "logistics" }, ids.userIds);
}, 180000);

afterAll(async () => {
  if (missionIds.length > 0) await db.delete(missions).where(inArray(missions.id, missionIds));
  await cleanupCreated(ids);
  await actors?.close();
}, 120000);

async function podColumns(missionId: number) {
  const [row] = await db
    .select({ podUrl: missions.podUrl, podUploadedAt: missions.podUploadedAt })
    .from(missions)
    .where(eq(missions.id, missionId));
  return row;
}

describe("POD : le corps d'une requête ne pose jamais la preuve", { timeout: 180000 }, () => {
  it("POST /api/missions avec podUrl et podUploadedAt : colonnes laissées vides", async () => {
    const res = await actors.call("POST", "/api/missions", {
      actor: "logistics",
      body: {
        orderNumber: uniqueTestToken("POD"),
        pickupAddress: "TEST A",
        deliveryAddress: "TEST B",
        podUrl: "/api/missions/1/pod-files/1",
        podUploadedAt: new Date().toISOString(),
      },
    });
    expect(res.status).toBe(201);
    missionIds.push(res.body.id);
    expect(await podColumns(res.body.id)).toEqual({ podUrl: null, podUploadedAt: null });
  });

  it("PATCH /api/missions/:id avec podUrl : colonne inchangée", async () => {
    const [mission] = await db
      .insert(missions)
      .values({ orderNumber: uniqueTestToken("POD"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "planned" } as any)
      .returning();
    missionIds.push(mission.id);
    const res = await actors.call("PATCH", `/api/missions/${mission.id}`, {
      actor: "logistics",
      body: { specialInstructions: "TEST pod", podUrl: "/faux", podUploadedAt: new Date().toISOString() },
    });
    expect(res.status).toBe(200);
    expect(await podColumns(mission.id)).toEqual({ podUrl: null, podUploadedAt: null });
  });
});
