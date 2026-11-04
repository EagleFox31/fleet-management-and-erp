import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Réserve 1 de #287 : la restauration de sauvegarde passe en une transaction, effets des
 * triggers coupés AVANT toute écriture (sinon chaque plein repris alerte, puis les alertes
 * sauvegardées échouent en 23505 et la base reste à moitié restaurée).
 */
const calls: string[] = [];
let failOn: string | null = null;

function sqlText(query: any): string {
  return (query?.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join("") : "")).join("");
}

function tableName(table: any): string {
  return table?.[Symbol.for("drizzle:Name")] ?? "?";
}

const tx = {
  execute: async (query: unknown) => {
    calls.push(`execute ${sqlText(query)}`);
  },
  delete: (table: unknown) => {
    calls.push(`delete ${tableName(table)}`);
    return Promise.resolve();
  },
  select: () => ({ from: async () => [{ username: "admin" }] }),
  insert: (table: unknown) => ({
    values: async () => {
      const name = tableName(table);
      calls.push(`insert ${name}`);
      if (failOn === name) throw Object.assign(new Error("duplicate key"), { code: "23505" });
    },
  }),
};

vi.mock("../../../server/db", () => ({
  db: {
    transaction: async (run: (t: typeof tx) => Promise<unknown>) => {
      calls.push("BEGIN");
      try {
        const result = await run(tx);
        calls.push("COMMIT");
        return result;
      } catch (error) {
        calls.push("ROLLBACK");
        throw error;
      }
    },
  },
}));

import { restoreBackup } from "../../../server/services/backup-import-service";

beforeEach(() => {
  calls.length = 0;
  failOn = null;
});

const backup = {
  users: [{ username: "admin" }, { username: "nouveau" }],
  vehicles: [{ id: 1 }],
  fuelRecords: [{ vehicleId: 1 }],
  alerts: [{ userId: 1 }],
} as any;

describe("restoreBackup", () => {
  it("coupe les effets des triggers avant la première écriture, dans la transaction", async () => {
    const stats = await restoreBackup(backup);
    expect(calls[0]).toBe("BEGIN");
    expect(calls[1]).toMatch(/set_config\('fleetos\.suppress_side_effects', 'on', true\)/);
    expect(calls.at(-1)).toBe("COMMIT");
    expect(calls.filter((c) => c.startsWith("insert"))).toEqual(["insert users", "insert vehicles", "insert fuel_records", "insert alerts"]);
    expect(stats).toMatchObject({ users: 1, vehicles: 1, fuelRecords: 1, alerts: 1 });
  });

  it("une insertion en échec annule tout : pas de restauration à moitié faite", async () => {
    failOn = "alerts";
    await expect(restoreBackup(backup)).rejects.toThrow("duplicate key");
    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
  });
});
