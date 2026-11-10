import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { IDEMPOTENCY_RETENTION_DAYS, OFFLINE_OWNER_HEADER } from "@shared/idempotency-routes";
import { createSessionChannel } from "@/lib/offline-session-channel";
import { createOfflineScope, offlineDbName, type OfflineKv } from "@/lib/offline-user-scope";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn(), queryClient: undefined }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

describe("en-têtes d'un envoi différé", () => {
  it("porte la clé et le propriétaire de la file, et le délai reste sous le bail", async () => {
    const { offlineRequestHeaders, SEND_TIMEOUT_MS } = await import("@/lib/offline-queue");
    expect(offlineRequestHeaders({ idempotencyKey: "k-1", ownerUserId: 7 })).toEqual({
      "Idempotency-Key": "k-1",
      [OFFLINE_OWNER_HEADER]: "7",
    });
    expect(SEND_TIMEOUT_MS).toBeGreaterThan(0);
    expect(SEND_TIMEOUT_MS).toBeLessThan(45_000);
  });
});

describe("canal de session : session-changed", () => {
  function fakeChannel() {
    const channels: Array<{ onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown) => void }> = [];
    const factory = () => {
      const c = { onmessage: null as ((e: MessageEvent) => void) | null, postMessage: vi.fn() };
      channels.push(c);
      return c as unknown as BroadcastChannel;
    };
    return { channels, factory };
  }

  it("transmet un changement de compte valide et ignore un message mal formé", () => {
    const { channels, factory } = fakeChannel();
    const channel = createSessionChannel(factory);
    const seen: unknown[] = [];
    channel.subscribe((m) => seen.push(m));
    const emit = (data: unknown) => channels[0].onmessage?.({ data } as MessageEvent);
    emit({ type: "session-changed", userId: 9 });
    emit({ type: "session-changed", userId: "9" });
    emit({ type: "session-changed" });
    emit({ type: "autre" });
    expect(seen).toEqual([{ type: "session-changed", userId: 9 }]);
  });
});

describe("purge : base vidée supprimée", () => {
  it("supprime la base du compte après l'avoir vidée", async () => {
    const dbs = new Map<string, Map<string, unknown>>([[offlineDbName(5), new Map([["queue", [1]]])]]);
    const dropped: string[] = [];
    const kv: OfflineKv = {
      get: async () => undefined,
      set: async () => undefined,
      del: async () => undefined,
      clearDb: async (db) => void dbs.get(db)?.clear(),
      dropDb: async (db) => {
        dropped.push(db);
        dbs.delete(db);
      },
      listDbs: async () => Array.from(dbs.keys()),
      delLegacy: async () => undefined,
    };
    await createOfflineScope(kv).purgeAll(5);
    expect(dropped).toContain(offlineDbName(5));
    expect(dbs.size).toBe(0);
  });
});

describe("rétention des clés : une seule valeur", () => {
  // Compare la constante à l'intervalle réellement écrit dans chaque SQL, pas à une sous-chaîne.
  const intervalsOf = (file: string) =>
    Array.from(readFileSync(file, "utf8").matchAll(/idempotency_keys[\s\S]{0,600}?now\(\)\s*\+\s*interval\s+'(\d+)\s+days?'/gi), (m) => Number(m[1]));

  it.each(["server/init-database.ts", "server/db/migrations/20261101_cdc_ecarts.sql"])("%s : intervalle égal à la constante", (file) => {
    const found = intervalsOf(file);
    expect(found.length).toBeGreaterThan(0);
    for (const days of found) expect(days).toBe(IDEMPOTENCY_RETENTION_DAYS);
  });

  it("shared/schema.ts : intervalle égal à la constante", () => {
    const m = readFileSync("shared/schema.ts", "utf8").match(/expiresAt:[^\n]*interval '(\d+) days?'/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(IDEMPOTENCY_RETENTION_DAYS);
  });
});

describe("signal de délai d'envoi", () => {
  it("repli AbortController quand AbortSignal.timeout est absent : le signal s'interrompt", async () => {
    vi.useFakeTimers();
    const original = AbortSignal.timeout;
    // @ts-expect-error vieux WebView sans AbortSignal.timeout
    AbortSignal.timeout = undefined;
    try {
      const { timeoutSignal } = await import("@/lib/offline-queue");
      const signal = timeoutSignal(1000);
      expect(signal.aborted).toBe(false);
      vi.advanceTimersByTime(1001);
      expect(signal.aborted).toBe(true);
    } finally {
      AbortSignal.timeout = original;
      vi.useRealTimers();
    }
  });

  it("utilise AbortSignal.timeout quand il existe", async () => {
    const { timeoutSignal } = await import("@/lib/offline-queue");
    expect(timeoutSignal(60_000).aborted).toBe(false);
  });
});
