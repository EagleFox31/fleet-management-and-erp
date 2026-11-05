import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Réserve 1 de #287 : la restauration de sauvegarde passe en une transaction, effets des
 * triggers coupés AVANT toute écriture (sinon chaque plein repris alerte, puis les alertes
 * sauvegardées échouent en 23505 et la base reste à moitié restaurée).
 */
const calls: string[] = [];
let inserted: Record<string, any> = {};
let failOn: string | null = null;
let linkedTreasury = false;

function sqlText(query: any): string {
  return (query?.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join("") : "")).join("");
}

function tableName(table: any): string {
  return table?.[Symbol.for("drizzle:Name")] ?? "?";
}

const tx = {
  execute: async (query: unknown) => {
    calls.push(`execute ${sqlText(query)}`);
    return { rows: [{ linked: linkedTreasury }] };
  },
  delete: (table: unknown) => {
    calls.push(`delete ${tableName(table)}`);
    return Promise.resolve();
  },
  select: () => ({ from: async () => [{ username: "admin" }] }),
  insert: (table: unknown) => ({
    values: async (v: unknown) => {
      const name = tableName(table);
      inserted[name] = v;
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
  inserted = {};
  linkedTreasury = false;
  delete process.env.FEATURE_FLAGS;
});

const backup = {
  users: [{ username: "admin" }, { username: "nouveau" }],
  vehicles: [{ id: 1 }],
  fuelRecords: [{ vehicleId: 1 }],
  alerts: [{ userId: 1 }],
} as any;

describe("restoreBackup", () => {
  it("drapeau finance actif, écriture liée à un plein : 409 avant toute suppression", async () => {
    process.env.FEATURE_FLAGS = "finance=on";
    linkedTreasury = true;
    await expect(restoreBackup(backup)).rejects.toMatchObject({ status: 409 });
    expect(calls.some((c) => c.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(calls.filter((c) => c.startsWith("delete") || c.startsWith("insert"))).toEqual([]);
    expect(calls.at(-1)).toBe("ROLLBACK");
  });

  it("drapeau finance actif sans écriture liée : la restauration passe", async () => {
    process.env.FEATURE_FLAGS = "finance=on";
    await expect(restoreBackup(backup)).resolves.toMatchObject({ vehicles: 1 });
    expect(calls.at(-1)).toBe("COMMIT");
  });

  it("drapeau finance coupé : ni verrou ni contrôle, comportement d'avant", async () => {
    linkedTreasury = true;
    await restoreBackup(backup);
    expect(calls.some((c) => c.includes("pg_advisory_xact_lock") || c.includes("treasury_entries"))).toBe(false);
    expect(calls.at(-1)).toBe("COMMIT");
  });

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

  it("valide le PIN comme les routes : vide, numerique, non conforme, hash conserve", async () => {
    const hash = "$2b$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234";
    const res = await restoreBackup({
      users: [
        { username: "u1", pin: "" },
        { username: "u2", pin: 1234 },
        { username: "u3", pin: "12345" },
        { username: "u4", pin: hash },
      ],
    } as any);
    const [u1, u2, u3, u4] = inserted.users;
    expect(u1.pin).toBeNull();
    expect(u2.pin).toMatch(/^\$2[aby]\$/);
    expect(u3.pin).toBeNull();
    expect(u4.pin).toBe(hash);
    expect(res.users).toBe(4);
    expect(calls.at(-1)).toBe("COMMIT");
  });
});
