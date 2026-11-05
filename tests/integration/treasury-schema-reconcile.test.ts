import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../server/db";
import { reportCdcConstraintGaps, TREASURY_RECONCILED_CONSTRAINTS, TREASURY_SCHEMA_STATEMENTS } from "../../server/init-database";

// Réconciliation des contraintes de trésorerie au démarrage. Tout se joue dans une transaction
// annulée : rien ne reste en base partagée.

const SQL = TREASURY_SCHEMA_STATEMENTS.map((statement) => `${statement};`).join("\n");
const CHECKS: [string, string][] = [
  ["treasury_accounts", "treasury_accounts_kind_check"],
  ["treasury_entries", "treasury_entries_amount_check"],
  ["treasury_entries", "treasury_entries_direction_check"],
  ["treasury_entries", "treasury_entries_category_check"],
];
const UNIQUES: [string, string][] = [
  ["treasury_accounts", "treasury_accounts_code_key"],
  ["treasury_entries", "treasury_entries_request_key_key"],
];

async function withClient(run: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Base de test poussée par drizzle-kit : on part de l'état réconcilié.
    await client.query(SQL);
    await run(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

async function definitions(client: PoolClient) {
  const { rows } = await client.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conname = ANY($1) ORDER BY conname`,
    [TREASURY_RECONCILED_CONSTRAINTS],
  );
  return rows.map((r) => `${r.conname} ${r.def} ${r.convalidated}`);
}

async function sqlState(client: PoolClient, statement: string) {
  await client.query("SAVEPOINT t_case");
  try {
    await client.query(statement);
    await client.query("RELEASE SAVEPOINT t_case");
    return { code: "ok", constraint: undefined as string | undefined };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT t_case");
    const e = error as { code?: string; constraint?: string };
    return { code: e.code ?? "unknown", constraint: e.constraint };
  }
}

describe("schéma trésorerie : réconciliation des contraintes", { timeout: 60_000 }, () => {
  it("repose les CHECK et UNIQUE absents, et un second passage ne change rien", async () => {
    await withClient(async (client) => {
      const fresh = await definitions(client);
      expect(fresh).toHaveLength(TREASURY_RECONCILED_CONSTRAINTS.length);
      for (const [table, name] of [...CHECKS, ...UNIQUES]) await client.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
      expect(await definitions(client)).toEqual([]);
      await client.query(SQL);
      expect(await definitions(client)).toEqual(fresh);
      await client.query(SQL);
      expect(await definitions(client)).toEqual(fresh);
      const warn = vi.fn();
      expect(await reportCdcConstraintGaps(client, { warn }, TREASURY_RECONCILED_CONSTRAINTS)).toEqual({ missing: [], notValidated: [] });
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it("renomme une unicité posée sous le nom Drizzle par défaut", async () => {
    await withClient(async (client) => {
      await client.query(`ALTER TABLE treasury_accounts DROP CONSTRAINT treasury_accounts_code_key`);
      await client.query(`ALTER TABLE treasury_accounts ADD CONSTRAINT treasury_accounts_code_unique UNIQUE (code)`);
      await client.query(SQL);
      const { rows } = await client.query(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'treasury_accounts'::regclass AND contype = 'u'`,
      );
      expect(rows.map((r) => r.conname)).toEqual(["treasury_accounts_code_key"]);
    });
  });

  it("une catégorie hors liste déjà en base laisse la CHECK NOT VALID, les écritures suivantes sont refusées", async () => {
    await withClient(async (client) => {
      await client.query(`ALTER TABLE treasury_entries DROP CONSTRAINT treasury_entries_category_check`);
      const { rows: [account] } = await client.query(
        `INSERT INTO treasury_accounts (code, label, kind) VALUES ('TRECON', 'x', 'cash') RETURNING id`,
      );
      await client.query(
        `INSERT INTO treasury_entries (account_id, entry_date, label, direction, amount, category) VALUES ($1, '2026-11-05', 'x', 'in', 1, 'ancienne')`,
        [account.id],
      );
      expect((await sqlState(client, SQL)).code).toBe("ok");
      const warn = vi.fn();
      expect(await reportCdcConstraintGaps(client, { warn }, TREASURY_RECONCILED_CONSTRAINTS)).toEqual({
        missing: [], notValidated: ["treasury_entries_category_check"],
      });
      expect(warn).toHaveBeenCalledOnce();
      expect(
        await sqlState(
          client,
          `INSERT INTO treasury_entries (account_id, entry_date, label, direction, amount, category) VALUES (${account.id}, '2026-11-05', 'x', 'in', 1, 'inconnue')`,
        ),
      ).toEqual({ code: "23514", constraint: "treasury_entries_category_check" });
    });
  });

  it("des clés de rejeu en double laissent l'unicité absente sans bloquer le démarrage", async () => {
    await withClient(async (client) => {
      await client.query(`ALTER TABLE treasury_entries DROP CONSTRAINT treasury_entries_request_key_key`);
      const { rows: [account] } = await client.query(
        `INSERT INTO treasury_accounts (code, label, kind) VALUES ('TRECON2', 'x', 'cash') RETURNING id`,
      );
      for (let i = 0; i < 2; i++) {
        await client.query(
          `INSERT INTO treasury_entries (account_id, entry_date, label, direction, amount, request_key) VALUES ($1, '2026-11-05', 'x', 'in', 1, 'entry:dup')`,
          [account.id],
        );
      }
      expect((await sqlState(client, SQL)).code).toBe("ok");
      const warn = vi.fn();
      expect(await reportCdcConstraintGaps(client, { warn }, TREASURY_RECONCILED_CONSTRAINTS)).toEqual({
        missing: ["treasury_entries_request_key_key"], notValidated: [],
      });
    });
  });
});
