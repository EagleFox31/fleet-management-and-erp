import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../server/db", () => ({ db: {}, pool: {} }));

import { AppError } from "../../../server/lib/app-error";
import { holdLastAdminLock, LOCK_FALLBACK_MS, type LockClient, type LockPool } from "../../../server/lib/last-admin";

function fakeClient(failOn?: (sql: string) => Error | undefined) {
  const queries: string[] = [];
  const releases: Array<Error | boolean | undefined> = [];
  const client: LockClient = {
    query: async (sql: string) => {
      queries.push(sql);
      const err = failOn?.(sql);
      if (err) throw err;
      return undefined;
    },
    release: (err?: Error | boolean) => {
      releases.push(err);
    },
  };
  const pool: LockPool = { connect: async () => client };
  return { pool, queries, releases };
}

function fakeRes() {
  const emitter = new EventEmitter() as EventEmitter & { writableEnded: boolean; end: (...a: unknown[]) => unknown };
  emitter.writableEnded = false;
  emitter.end = () => {
    emitter.writableEnded = true;
    return emitter;
  };
  return emitter;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("holdLastAdminLock", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  it("libère sur finish : déverrouillage, remise à zéro, connexion rendue au pool", async () => {
    const { pool, queries, releases } = fakeClient();
    const res = fakeRes();
    await holdLastAdminLock(res as never, { pool });
    expect(releases).toHaveLength(0);
    res.emit("finish");
    await flush();
    expect(queries.some((q) => q.includes("pg_advisory_unlock"))).toBe(true);
    expect(releases).toEqual([undefined]);
  });

  it("(1) échec du déverrouillage : la connexion est détruite, pas rendue au pool", async () => {
    const boom = new Error("unlock failed");
    const { pool, releases } = fakeClient((sql) => (sql.includes("pg_advisory_unlock") ? boom : undefined));
    const res = fakeRes();
    await holdLastAdminLock(res as never, { pool });
    res.emit("finish");
    await flush();
    expect(releases).toEqual([true]);
  });

  it("(2) close avant la fin de l'écriture : verrou tenu jusqu'à finish", async () => {
    const { pool, queries, releases } = fakeClient();
    const res = fakeRes();
    await holdLastAdminLock(res as never, { pool, fallbackMs: 1000 });
    res.emit("close");
    await flush();
    expect(queries.some((q) => q.includes("pg_advisory_unlock"))).toBe(false);
    expect(releases).toHaveLength(0);
    res.emit("finish");
    await flush();
    expect(releases).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    await flush();
    expect(releases).toHaveLength(1);
  });

  it("(2) close sans finish : le minuteur de secours libère", async () => {
    const { pool, queries, releases } = fakeClient();
    const res = fakeRes();
    await holdLastAdminLock(res as never, { pool, fallbackMs: 1000 });
    res.emit("close");
    vi.advanceTimersByTime(999);
    await flush();
    expect(releases).toHaveLength(0);
    vi.advanceTimersByTime(2);
    await flush();
    expect(queries.some((q) => q.includes("pg_advisory_unlock"))).toBe(true);
    expect(releases).toHaveLength(1);
  });

  it("(2) close sur une réponse déjà terminée : libération immédiate", async () => {
    const { pool, releases } = fakeClient();
    const res = fakeRes();
    await holdLastAdminLock(res as never, { pool });
    res.writableEnded = true;
    res.emit("close");
    await flush();
    expect(releases).toHaveLength(1);
  });

  it("(2) client déjà coupé quand le verrou est obtenu : minuteur de secours armé (sinon fuite)", async () => {
    const { pool, releases } = fakeClient();
    const res = fakeRes() as ReturnType<typeof fakeRes> & { destroyed: boolean };
    res.destroyed = true;
    await holdLastAdminLock(res as never, { pool, fallbackMs: 1000 });
    expect(releases).toHaveLength(0);
    vi.advanceTimersByTime(1001);
    await flush();
    expect(releases).toHaveLength(1);
  });

  it("(2) réponse déjà terminée quand le verrou est obtenu : libération aussitôt", async () => {
    const { pool, releases } = fakeClient();
    const res = fakeRes() as ReturnType<typeof fakeRes> & { writableFinished: boolean };
    res.writableFinished = true;
    await holdLastAdminLock(res as never, { pool });
    await flush();
    expect(releases).toHaveLength(1);
  });

  it("(3) statement_timeout (57014) : 409 lisible, connexion détruite", async () => {
    const timeout = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    const { pool, releases } = fakeClient((sql) => (sql.includes("pg_advisory_lock") ? timeout : undefined));
    const error = await holdLastAdminLock(fakeRes() as never, { pool }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(409);
    expect(error.message).toBe("Opération en cours sur les administrateurs, réessayez.");
    expect(releases).toEqual([timeout]);
  });

  it("(4) socket détruite : pas de libération au délai court, libération dès res.end", async () => {
    const { pool, queries, releases } = fakeClient();
    const res = fakeRes() as ReturnType<typeof fakeRes> & { destroyed: boolean };
    res.destroyed = true;
    await holdLastAdminLock(res as never, { pool });
    res.emit("close");
    vi.advanceTimersByTime(20000); // bien au-delà de l'ancien minuteur de 5 s : écriture aval encore en cours
    await flush();
    expect(queries.some((q) => q.includes("pg_advisory_unlock"))).toBe(false);
    expect(releases).toHaveLength(0);
    res.end();
    await flush();
    expect(queries.some((q) => q.includes("pg_advisory_unlock"))).toBe(true);
    expect(releases).toHaveLength(1);
    res.end();
    vi.advanceTimersByTime(60000);
    await flush();
    expect(releases).toHaveLength(1);
  });

  it("(4) filet long : sans res.end ni finish, libération au bout de LOCK_FALLBACK_MS", async () => {
    const { pool, releases } = fakeClient();
    const res = fakeRes() as ReturnType<typeof fakeRes> & { destroyed: boolean };
    res.destroyed = true;
    await holdLastAdminLock(res as never, { pool });
    vi.advanceTimersByTime(LOCK_FALLBACK_MS - 1);
    await flush();
    expect(releases).toHaveLength(0);
    vi.advanceTimersByTime(2);
    await flush();
    expect(releases).toHaveLength(1);
  });
});
