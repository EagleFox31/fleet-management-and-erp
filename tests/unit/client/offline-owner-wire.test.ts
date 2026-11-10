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
  it("le schéma et le bootstrap SQL lisent la même durée que la constante partagée", () => {
    const expected = `interval '${IDEMPOTENCY_RETENTION_DAYS} days'`;
    expect(readFileSync("shared/schema.ts", "utf8")).toContain(expected);
    expect(readFileSync("server/init-database.ts", "utf8")).toContain(expected);
  });
});
