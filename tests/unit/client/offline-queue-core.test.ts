import { describe, expect, it, vi } from "vitest";
import {
  backoffDelay,
  classifyOutcome,
  createOfflineQueue,
  discardSendsLabel,
  logoutBlockedMessage,
  reconnectMessage,
  type OfflineQueueDeps,
  type OwnerCheck,
  type QueueEntry,
  type SendOutcome,
} from "@/lib/offline-queue-core";
import { LEASE_KEY_PREFIX, createLockProvider, type LockManagerLike } from "@/lib/offline-locks";

const DEFINITION = { type: "fuel_entry", label: "Plein", method: "POST" as const, endpoint: () => "/api/x" };

function harness(options: { active?: number | null; owner?: OwnerCheck; initial?: unknown[] } = {}) {
  let active: number | null = options.active === undefined ? 7 : options.active;
  const disk = new Map<number, unknown[]>();
  if (options.initial) disk.set(7, options.initial);
  const epochs = new Map<number, number>();
  const sent: Array<{ id: string; key: string }> = [];
  const script: SendOutcome[] = [];
  const hooks: { beforeSend?: () => void } = {};
  let uuidCounter = 0;
  let clock = 1_000_000;
  const onDrained = vi.fn();
  const onAuthStopped = vi.fn();
  const invalidateFor = vi.fn();
  let busy = false;
  const deps: OfflineQueueDeps = {
    store: {
      read: async (id) => structuredClone(disk.get(id) ?? []),
      write: async (id, entries, epoch) => {
        if ((epochs.get(id) ?? 0) !== epoch) return false;
        disk.set(id, structuredClone(entries));
        return true;
      },
      epochOf: (id) => epochs.get(id) ?? 0,
    },
    getActiveUserId: () => active,
    send: async (entry) => {
      hooks.beforeSend?.();
      sent.push({ id: entry.id, key: entry.idempotencyKey });
      return script.shift() ?? { ok: true, replayed: false };
    },
    checkOwner: async () => options.owner ?? { kind: "user", id: 7 },
    withMutationLock: async (_u, fn) => fn(),
    tryReplayLock: async (_u, fn) => {
      if (busy) return { acquired: false };
      busy = true;
      try {
        return { acquired: true, value: await fn(() => {}) };
      } finally {
        busy = false;
      }
    },
    getDefinition: (type) => (type === "fuel_entry" ? DEFINITION : undefined),
    invalidateFor,
    onDrained,
    onAuthStopped,
    now: () => clock,
    uuid: () => `uuid-${++uuidCounter}`,
  };
  return {
    queue: createOfflineQueue(deps),
    disk,
    sent,
    script,
    hooks,
    onDrained,
    onAuthStopped,
    invalidateFor,
    setActive: (id: number | null) => {
      active = id;
    },
    purge: (id: number) => {
      epochs.set(id, (epochs.get(id) ?? 0) + 1);
      disk.delete(id);
    },
  };
}

const entries = (h: ReturnType<typeof harness>) => (h.disk.get(7) ?? []) as QueueEntry[];
const fail = (status?: number, code?: string, message = "m"): SendOutcome => ({ ok: false, status, code, message });

describe("classifyOutcome", () => {
  const cases: Array<[SendOutcome, string]> = [
    [{ ok: true, replayed: false }, "done"],
    [{ ok: true, replayed: true }, "done"],
    [fail(409, "IDEMPOTENCY_IN_PROGRESS"), "in-progress"],
    [fail(401), "auth"],
    [fail(undefined), "retry"],
    [fail(500), "retry"],
    [fail(503), "retry"],
    [fail(408), "retry"],
    [fail(429), "retry"],
    [fail(400), "rejected"],
    [fail(403), "rejected"],
    [fail(409, "OTHER"), "rejected"],
    [fail(422), "rejected"],
  ];
  it.each(cases)("classe %j en %s", (outcome, expected) => {
    expect(classifyOutcome(outcome)).toBe(expected);
  });

  it("attente exponentielle plafonnée", () => {
    expect(backoffDelay(1)).toBeLessThan(backoffDelay(2));
    expect(backoffDelay(50)).toBe(5 * 60_000);
  });
});

describe("file d'écritures différées", () => {
  it("refuse sans utilisateur actif et pour un type inconnu", async () => {
    const h = harness({ active: null });
    await expect(h.queue.enqueue({ type: "fuel_entry", payload: {} })).rejects.toMatchObject({ reason: "no-user" });
    h.setActive(7);
    await expect(h.queue.enqueue({ type: "zzz", payload: {} })).rejects.toMatchObject({ reason: "unknown-type" });
  });

  it("rejoue en FIFO avec la clé stockée, supprime après le 2xx et invalide chaque envoi", async () => {
    const h = harness();
    const a = await h.queue.enqueue({ type: "fuel_entry", payload: { n: 1 } });
    const b = await h.queue.enqueue({ type: "fuel_entry", payload: { n: 2 } });
    const result = await h.queue.replay();
    expect(result).toMatchObject({ status: "drained", sent: 2, remaining: 0 });
    expect(h.sent.map((s) => s.id)).toEqual([a.id, b.id]);
    expect(h.sent.map((s) => s.key)).toEqual([a.idempotencyKey, b.idempotencyKey]);
    expect(entries(h)).toHaveLength(0);
    expect(h.invalidateFor).toHaveBeenCalledTimes(2);
    expect(h.onDrained).toHaveBeenCalledTimes(1);
  });

  it("s'arrête au premier échec réessayable et garde la même clé au rejeu", async () => {
    const h = harness();
    const a = await h.queue.enqueue({ type: "fuel_entry", payload: {} });
    await h.queue.enqueue({ type: "fuel_entry", payload: {} });
    h.script.push(fail(503, undefined, "Serveur occupé"));
    const first = await h.queue.replay();
    expect(first).toMatchObject({ status: "stopped", reason: "retry", sent: 0, remaining: 2 });
    expect(h.sent).toHaveLength(1);
    expect(entries(h)[0]).toMatchObject({ state: "pending", attempts: 1, lastError: "Serveur occupé" });
    expect(h.onDrained).not.toHaveBeenCalled();

    // Avant l'échéance rien ne part ; en manuel, ça repart avec la même clé.
    expect(await h.queue.replay()).toMatchObject({ status: "stopped", reason: "retry" });
    expect(h.sent).toHaveLength(1);
    const second = await h.queue.replay({ ignoreBackoff: true });
    expect(second).toMatchObject({ status: "drained", sent: 2 });
    expect(h.sent[1].key).toBe(a.idempotencyKey);
  });

  it("409 en cours : réessaie plus tard sans rejeter", async () => {
    const h = harness();
    await h.queue.enqueue({ type: "fuel_entry", payload: {} });
    h.script.push(fail(409, "IDEMPOTENCY_IN_PROGRESS", "En cours"));
    expect(await h.queue.replay()).toMatchObject({ status: "stopped", reason: "retry" });
    expect(entries(h)[0].state).toBe("pending");
  });

  it("Idempotent-Replayed compte comme un envoi abouti", async () => {
    const h = harness();
    await h.queue.enqueue({ type: "fuel_entry", payload: {} });
    h.script.push({ ok: true, replayed: true });
    expect(await h.queue.replay()).toMatchObject({ status: "drained", sent: 1 });
    expect(entries(h)).toHaveLength(0);
  });

  it("4xx autre : À revoir, jamais rejoué ni supprimé, la file continue", async () => {
    const h = harness();
    const a = await h.queue.enqueue({ type: "fuel_entry", payload: {} });
    await h.queue.enqueue({ type: "fuel_entry", payload: {} });
    h.script.push(fail(422, undefined, "Donnée refusée"));
    const result = await h.queue.replay();
    expect(result).toMatchObject({ sent: 1, rejected: 1 });
    expect(entries(h)).toHaveLength(1);
    expect(entries(h)[0]).toMatchObject({ id: a.id, state: "rejected", lastError: "Donnée refusée" });

    h.sent.length = 0;
    await h.queue.replay({ ignoreBackoff: true });
    expect(h.sent).toHaveLength(0);
    expect(entries(h)).toHaveLength(1);

    expect(await h.queue.retryRejected(7, a.id)).toBe(true);
    await h.queue.replay({ ignoreBackoff: true });
    expect(h.sent[0].key).toBe(a.idempotencyKey);
  });

  it("401 : arrête, garde la file entière et prévient", async () => {
    const h = harness();
    await h.queue.enqueue({ type: "fuel_entry", payload: {} });
    await h.queue.enqueue({ type: "fuel_entry", payload: {} });
    h.script.push(fail(401, undefined, "Session expirée"));
    expect(await h.queue.replay()).toMatchObject({ status: "stopped", reason: "auth", remaining: 2 });
    expect(entries(h)).toHaveLength(2);
    expect(h.onAuthStopped).toHaveBeenCalledWith(2);
    expect(h.onDrained).not.toHaveBeenCalled();
  });

  it("propriétaire /me différent ou session refusée : aucun envoi, file gardée", async () => {
    const other = harness({ owner: { kind: "user", id: 99 } });
    await other.queue.enqueue({ type: "fuel_entry", payload: {} });
    await other.queue.replay();
    expect(other.sent).toHaveLength(0);
    expect(entries(other)).toHaveLength(1);

    const anon = harness({ owner: { kind: "unauthorized" } });
    await anon.queue.enqueue({ type: "fuel_entry", payload: {} });
    await anon.queue.replay();
    expect(anon.sent).toHaveLength(0);
    expect(entries(anon)).toHaveLength(1);
  });

  it("changement de compte pendant le rejeu : arrêt, aucune écriture sur l'autre compte", async () => {
    const h = harness();
    await h.queue.enqueue({ type: "fuel_entry", payload: {} });
    await h.queue.enqueue({ type: "fuel_entry", payload: {} });
    h.hooks.beforeSend = () => h.setActive(8);
    const result = await h.queue.replay();
    expect(result.status).toBe("stopped");
    expect(h.sent).toHaveLength(1);
    expect(h.disk.get(8)).toBeUndefined();
    expect(h.onDrained).not.toHaveBeenCalled();
  });

  it("purge pendant le rejeu : la file n'est pas ressuscitée", async () => {
    const h = harness();
    await h.queue.enqueue({ type: "fuel_entry", payload: {} });
    await h.queue.enqueue({ type: "fuel_entry", payload: {} });
    h.hooks.beforeSend = () => h.purge(7);
    await h.queue.replay();
    expect(entries(h)).toHaveLength(0);
    expect(h.sent).toHaveLength(1);
  });

  it("un seul rejeu à la fois (verrou de rejeu)", async () => {
    const h = harness();
    await h.queue.enqueue({ type: "fuel_entry", payload: {} });
    const [a, b] = await Promise.all([h.queue.replay(), h.queue.replay()]);
    expect([a.status, b.status].sort()).toEqual(["drained", "skipped"]);
    expect(h.sent).toHaveLength(1);
  });

  it("migre sans perte l'ancienne file et crée une clé stable", async () => {
    const h = harness({
      initial: [
        {
          id: "offline-1",
          type: "fuel_entry",
          endpoint: "/api/old",
          method: "POST",
          payload: { a: 1 },
          createdAt: 5,
          label: "Plein",
        },
      ],
    });
    const list = await h.queue.list(7);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "offline-1", endpoint: "/api/old", state: "pending", attempts: 0, ownerUserId: 7 });
    expect(list[0].idempotencyKey).toBeTruthy();
    expect((await h.queue.list(7))[0].idempotencyKey).toBe(list[0].idempotencyKey);
  });
});

describe("messages", () => {
  it("libellés de déconnexion et de reconnexion", () => {
    expect(discardSendsLabel(3)).toBe("Supprimer 3 envois");
    expect(discardSendsLabel(1)).toBe("Supprimer 1 envoi");
    expect(reconnectMessage(2)).toBe("Reconnectez-vous pour envoyer 2 éléments");
    expect(logoutBlockedMessage(2)).toContain("2 envois");
  });
});

describe("verrou entre onglets", () => {
  function fakeStorage() {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  }

  it("bail de repli : le second onglet n'obtient pas le verrou tant que le premier le tient", async () => {
    const storage = fakeStorage();
    const make = (ownerId: string) =>
      createLockProvider({ locks: null, storage: () => storage, now: () => 0, ownerId, leaseMs: 1000 });
    const tabA = make("a");
    const tabB = make("b");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const running = tabA.tryRun("replay", async () => gate);
    await new Promise((r) => setTimeout(r, 5));
    expect(await tabB.tryRun("replay", async () => 1)).toEqual({ acquired: false });
    release();
    expect(await running).toMatchObject({ acquired: true });
    expect(await tabB.tryRun("replay", async () => 2)).toEqual({ acquired: true, value: 2 });
  });

  it("bail expiré : un onglet planté ne bloque pas", async () => {
    const storage = fakeStorage();
    let t = 100;
    storage.setItem(`${LEASE_KEY_PREFIX}replay`, JSON.stringify({ owner: "dead", expires: 500 }));
    const tab = createLockProvider({ locks: null, storage: () => storage, now: () => t, ownerId: "x", leaseMs: 1000 });
    expect(await tab.tryRun("replay", async () => 1)).toEqual({ acquired: false });
    t = 600;
    expect(await tab.tryRun("replay", async () => 1)).toEqual({ acquired: true, value: 1 });
  });

  it("Web Locks : ifAvailable refuse quand le verrou est pris", async () => {
    const held = new Set<string>();
    const locks = {
      request: async (name: string, opts: unknown, cb?: (lock: unknown) => Promise<unknown>) => {
        const callback = (cb ?? opts) as (lock: unknown) => Promise<unknown>;
        const ifAvailable = typeof opts === "object" && (opts as { ifAvailable?: boolean }).ifAvailable;
        if (held.has(name)) return ifAvailable ? callback(null) : callback({});
        held.add(name);
        try {
          return await callback({});
        } finally {
          held.delete(name);
        }
      },
    } as unknown as LockManagerLike;
    const make = (ownerId: string) =>
      createLockProvider({ locks, storage: () => null, now: () => 0, ownerId, leaseMs: 1000 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = make("a").tryRun("replay", async () => gate);
    await new Promise((r) => setTimeout(r, 5));
    expect(await make("b").tryRun("replay", async () => 1)).toEqual({ acquired: false });
    release();
    await first;
  });
});
