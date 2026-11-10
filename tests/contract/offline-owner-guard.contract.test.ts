import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER, OFFLINE_OWNER_HEADER } from "../../shared/idempotency-routes";
import { idempotencyKeys } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { uniqueTestToken } from "../support/ids";

/**
 * V5b-2b : un envoi différé annonce le propriétaire de sa file (`X-Offline-Owner`). Le cookie de
 * session est partagé entre onglets : le propriétaire vérifié une fois avant la boucle ne couvre pas la
 * boucle. Le serveur compare à chaque envoi et refuse (409 OFFLINE_OWNER_MISMATCH) avant toute écriture.
 */

const ACTORS = { driverA: "driver", driverB: "driver" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const previousFlags = process.env.FEATURE_FLAGS;
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

// Mission inexistante : le garde de propriétaire passe ou refuse avant que la route ne cherche la mission.
const PATH = "/api/missions/2147483000/status";

async function put(actor: Actor, headers: Record<string, string>) {
  const res = await fetch(session.baseUrl + PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: session.cookies.get(actor)!, ...headers },
    body: JSON.stringify({ status: "in_progress" }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const keysOf = async (actor: Actor) =>
  (await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.userId, session.userIdOf(actor)))).length;

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "offline-writes=on";
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("V5b-2b : propriétaire de la file contre session", { timeout: 120000 }, () => {
  it("propriétaire autre que la session : 409 dédié, aucune écriture, clé non réservée", async () => {
    const key = uniqueTestToken("own");
    const sent = await put("driverA", {
      [IDEMPOTENCY_HEADER]: key,
      [OFFLINE_OWNER_HEADER]: String(session.userIdOf("driverB")),
    });
    expect(sent.status).toBe(409);
    expect(sent.body.code).toBe("OFFLINE_OWNER_MISMATCH");
    expect(JSON.stringify(sent.body)).not.toContain(String(session.userIdOf("driverB")));
    expect(await keysOf("driverA")).toBe(0);
    expect(await keysOf("driverB")).toBe(0);
  });

  it("en-tête illisible : refusé de la même façon", async () => {
    for (const value of ["abc", "1; DROP", "-1", "1e3", ""]) {
      const sent = await put("driverA", { [IDEMPOTENCY_HEADER]: uniqueTestToken("bad"), [OFFLINE_OWNER_HEADER]: value });
      expect(sent.body?.code).toBe("OFFLINE_OWNER_MISMATCH");
      expect(sent.status).toBe(409);
    }
  });

  it("propriétaire égal à la session : l'envoi passe le garde (la route répond ensuite)", async () => {
    const sent = await put("driverA", {
      [IDEMPOTENCY_HEADER]: uniqueTestToken("ok"),
      [OFFLINE_OWNER_HEADER]: String(session.userIdOf("driverA")),
    });
    expect(sent.body?.code).not.toBe("OFFLINE_OWNER_MISMATCH");
  });

  it("en-tête absent : comportement inchangé", async () => {
    const sent = await put("driverA", { [IDEMPOTENCY_HEADER]: uniqueTestToken("none") });
    expect(sent.body?.code).not.toBe("OFFLINE_OWNER_MISMATCH");
  });

  it("propriétaire sans clé d'idempotence : le garde ne s'applique qu'aux envois différés", async () => {
    const sent = await put("driverA", { [OFFLINE_OWNER_HEADER]: String(session.userIdOf("driverB")) });
    expect(sent.body?.code).not.toBe("OFFLINE_OWNER_MISMATCH");
  });
});

describe("V5b-2b : CORS de l'application mobile", { timeout: 120000 }, () => {
  it("le preflight depuis https://localhost autorise Idempotency-Key et X-Offline-Owner, la réponse expose Idempotent-Replayed", async () => {
    const res = await fetch(session.baseUrl + PATH, {
      method: "OPTIONS",
      headers: {
        Origin: "https://localhost",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "idempotency-key,x-offline-owner,content-type",
      },
    });
    expect(res.status).toBe(204);
    const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase().split(/\s*,\s*/);
    expect(allowed).toEqual(expect.arrayContaining([IDEMPOTENCY_HEADER.toLowerCase(), OFFLINE_OWNER_HEADER.toLowerCase()]));
    const exposed = (res.headers.get("access-control-expose-headers") ?? "").toLowerCase().split(/\s*,\s*/);
    expect(exposed).toContain(IDEMPOTENCY_REPLAYED_HEADER.toLowerCase());
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
  });
});
