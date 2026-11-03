import { createHash } from "crypto";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { idempotencyKeys } from "@shared/schema";
import { IDEMPOTENCY_STALE_SECONDS } from "./idempotency-config";

/** Identité d'une écriture rejouable : la clé est propre à l'utilisateur. */
export type IdempotencyRequest = {
  userId: number;
  key: string;
  method: string;
  path: string;
  requestHash: string;
};

export type ReserveOutcome =
  | { kind: "reserved" }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "in_progress" }
  | { kind: "mismatch" };

/** Accès à `idempotency_keys`. Injecté dans le garde pour le tester sans base. */
export type IdempotencyStore = {
  reserve(request: IdempotencyRequest): Promise<ReserveOutcome>;
  complete(userId: number, key: string, status: number, body: unknown): Promise<void>;
  release(userId: number, key: string): Promise<void>;
  purgeExpired(): Promise<number>;
};

/** JSON à clés triées : deux corps égaux donnent la même empreinte quel que soit l'ordre. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

/** Empreinte d'une requête : méthode, chemin normalisé et corps. */
export function hashRequest(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method.toUpperCase()} ${path}\n${stableStringify(body ?? null)}`).digest("hex");
}

type Db = typeof import("../db").db;

/** Stockage Postgres. `db` injectable pour les tests d'intégration. */
export function createIdempotencyStore(getDb: () => Promise<Db>): IdempotencyStore {
  const keyOf = (userId: number, key: string) => and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key));

  return {
    async reserve(request) {
      const db = await getDb();
      // Clé expirée ou restée en cours après un arrêt du serveur : reprise.
      await db
        .delete(idempotencyKeys)
        .where(
          and(
            keyOf(request.userId, request.key),
            or(
              lt(idempotencyKeys.expiresAt, sql`now()`),
              and(
                eq(idempotencyKeys.state, "in_progress"),
                lt(idempotencyKeys.createdAt, sql`now() - make_interval(secs => ${IDEMPOTENCY_STALE_SECONDS})`),
              ),
            ),
          ),
        );

      const inserted = await db
        .insert(idempotencyKeys)
        .values({ ...request, state: "in_progress" })
        .onConflictDoNothing({ target: [idempotencyKeys.userId, idempotencyKeys.key] })
        .returning({ id: idempotencyKeys.id });
      if (inserted.length > 0) return { kind: "reserved" };

      const [row] = await db.select().from(idempotencyKeys).where(keyOf(request.userId, request.key)).limit(1);
      // Ligne supprimée entre-temps (purge) : le client réessaiera.
      if (!row) return { kind: "in_progress" };
      if (row.method !== request.method || row.path !== request.path || row.requestHash !== request.requestHash) {
        return { kind: "mismatch" };
      }
      if (row.state !== "completed" || row.responseStatus === null) return { kind: "in_progress" };
      return { kind: "replay", status: row.responseStatus, body: row.responseBody };
    },

    async complete(userId, key, status, body) {
      const db = await getDb();
      await db
        .update(idempotencyKeys)
        .set({ state: "completed", responseStatus: status, responseBody: body ?? null })
        .where(and(keyOf(userId, key), eq(idempotencyKeys.state, "in_progress")));
    },

    async release(userId, key) {
      const db = await getDb();
      await db.delete(idempotencyKeys).where(and(keyOf(userId, key), eq(idempotencyKeys.state, "in_progress")));
    },

    async purgeExpired() {
      const db = await getDb();
      const deleted = await db
        .delete(idempotencyKeys)
        .where(lt(idempotencyKeys.expiresAt, sql`now()`))
        .returning({ id: idempotencyKeys.id });
      return deleted.length;
    },
  };
}

/** Stockage de production : `db` importé à la demande, le module reste chargeable sans base. */
export const idempotencyStore: IdempotencyStore = createIdempotencyStore(async () => (await import("../db")).db);
