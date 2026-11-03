import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { createIdempotencyStore, hashRequest, type IdempotencyRequest } from "../../server/lib/idempotency-store";
import { idempotencyKeys } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau I, stockage des clés d'idempotence (CDC #10b) sur Postgres réel.
 * Réservation, rejeu, autre requête sur la même clé, reprise d'une clé bloquée ou expirée,
 * libération et purge. Les lignes partent en cascade avec les comptes de test.
 */

const ids = createIdBag();
const store = createIdempotencyStore(async () => db);

afterAll(async () => {
  await cleanupCreated(ids);
});

async function newRequest(body: unknown = { kilometers: 1000 }): Promise<IdempotencyRequest> {
  const user = await createTestUser({ role: "driver" });
  ids.userIds.push(user.id);
  const path = "/vehicles/1/mileage";
  return { userId: user.id, key: uniqueTestToken("idem"), method: "PUT", path, requestHash: hashRequest("PUT", path, body) };
}

async function rowOf(request: IdempotencyRequest) {
  const [row] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, request.userId), eq(idempotencyKeys.key, request.key)));
  return row;
}

describe("Stockage des clés d'idempotence", { timeout: 120000 }, () => {
  it("réserve, refuse la même clé en cours, puis rejoue la réponse enregistrée", async () => {
    const request = await newRequest();

    expect(await store.reserve(request)).toEqual({ kind: "reserved" });
    expect(await store.reserve(request)).toEqual({ kind: "in_progress" });

    await store.complete(request.userId, request.key, 200, { id: 1, kilometers: 1000 });
    expect(await store.reserve(request)).toEqual({ kind: "replay", status: 200, body: { id: 1, kilometers: 1000 } });
    expect((await rowOf(request)).state).toBe("completed");
  });

  it("même clé pour un autre corps ou un autre chemin : mismatch, la ligne d'origine reste", async () => {
    const request = await newRequest();
    await store.reserve(request);
    await store.complete(request.userId, request.key, 200, { ok: true });

    const otherBody = { ...request, requestHash: hashRequest("PUT", request.path, { kilometers: 2000 }) };
    expect(await store.reserve(otherBody)).toEqual({ kind: "mismatch" });
    expect(await store.reserve({ ...request, path: "/vehicles/2/mileage" })).toEqual({ kind: "mismatch" });
    expect((await rowOf(request)).requestHash).toBe(request.requestHash);
  });

  it("la clé est propre au compte : un autre utilisateur peut réutiliser la même valeur", async () => {
    const first = await newRequest();
    const second = { ...(await newRequest()), key: first.key };

    expect(await store.reserve(first)).toEqual({ kind: "reserved" });
    expect(await store.reserve(second)).toEqual({ kind: "reserved" });
  });

  it("deux réservations simultanées : une seule passe", async () => {
    const request = await newRequest();
    const outcomes = await Promise.all([store.reserve(request), store.reserve(request), store.reserve(request)]);

    expect(outcomes.filter((o) => o.kind === "reserved")).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === "in_progress")).toHaveLength(2);
  });

  it("une clé restée en cours au-delà du délai de reprise est reprise", async () => {
    const request = await newRequest();
    await store.reserve(request);
    await db
      .update(idempotencyKeys)
      .set({ createdAt: sql`now() - interval '2 minutes'` })
      .where(and(eq(idempotencyKeys.userId, request.userId), eq(idempotencyKeys.key, request.key)));

    expect(await store.reserve(request)).toEqual({ kind: "reserved" });
  });

  it("une clé terminée récente n'est pas reprise, une clé expirée l'est", async () => {
    const request = await newRequest();
    await store.reserve(request);
    await store.complete(request.userId, request.key, 200, { ok: true });
    await db
      .update(idempotencyKeys)
      .set({ createdAt: sql`now() - interval '2 minutes'` })
      .where(eq(idempotencyKeys.userId, request.userId));
    expect((await store.reserve(request)).kind).toBe("replay");

    await db
      .update(idempotencyKeys)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(idempotencyKeys.userId, request.userId));
    expect(await store.reserve(request)).toEqual({ kind: "reserved" });
  });

  it("release libère une clé en cours, jamais une clé terminée", async () => {
    const pending = await newRequest();
    await store.reserve(pending);
    await store.release(pending.userId, pending.key);
    expect(await rowOf(pending)).toBeUndefined();

    const done = await newRequest();
    await store.reserve(done);
    await store.complete(done.userId, done.key, 201, { id: 7 });
    await store.release(done.userId, done.key);
    expect((await rowOf(done)).state).toBe("completed");
  });

  it("complete n'écrase pas une réponse déjà enregistrée", async () => {
    const request = await newRequest();
    await store.reserve(request);
    await store.complete(request.userId, request.key, 200, { first: true });
    await store.complete(request.userId, request.key, 500, { second: true });

    const row = await rowOf(request);
    expect(row.responseStatus).toBe(200);
    expect(row.responseBody).toEqual({ first: true });
  });

  it("purgeExpired supprime les clés expirées et garde les autres", async () => {
    const expired = await newRequest();
    const alive = await newRequest();
    await store.reserve(expired);
    await store.reserve(alive);
    await db
      .update(idempotencyKeys)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(idempotencyKeys.userId, expired.userId));

    expect(await store.purgeExpired()).toBeGreaterThanOrEqual(1);
    expect(await rowOf(expired)).toBeUndefined();
    expect(await rowOf(alive)).toBeDefined();
    // Second passage convergé : rien de plus à purger pour ces comptes.
    await store.purgeExpired();
    expect(await rowOf(alive)).toBeDefined();
  });
});
