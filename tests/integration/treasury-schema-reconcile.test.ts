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

  it("deux cartes carburant actives : index unique non posé, démarrage non bloqué ; posé une fois réglé", async () => {
    await withClient(async (client) => {
      await client.query(`DROP INDEX uq_treasury_accounts_active_fuel_card`);
      await client.query(`UPDATE treasury_accounts SET is_active = false WHERE kind = 'fuel_card'`);
      await client.query(`INSERT INTO treasury_accounts (code, label, kind) VALUES ('TRECONC1', 'x', 'fuel_card'), ('TRECONC2', 'y', 'fuel_card')`);
      const index = async () => (await client.query(`SELECT to_regclass('uq_treasury_accounts_active_fuel_card') AS r`)).rows[0].r;
      expect((await sqlState(client, SQL)).code).toBe("ok");
      expect(await index()).toBeNull();
      await client.query(`UPDATE treasury_accounts SET is_active = false WHERE code = 'TRECONC2'`);
      await client.query(SQL);
      expect(await index()).not.toBeNull();
    });
  });

  it("FK véhicule et mission sans ON DELETE : remplacées en SET NULL sous le même nom ; second passage sans effet", async () => {
    await withClient(async (client) => {
      const fks = async () =>
        (
          await client.query(
            `SELECT k.conname, k.confdeltype, k.convalidated FROM pg_constraint k
             JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
             WHERE k.conrelid = 'treasury_entries'::regclass AND k.contype = 'f' AND a.attname IN ('vehicle_id', 'mission_id')
             ORDER BY k.conname`,
          )
        ).rows;
      const before = await fks();
      expect(before).toHaveLength(2);
      expect(before.every((r) => r.confdeltype === "n")).toBe(true);
      for (const { conname } of before) {
        const ref = conname.includes("vehicle") ? ["vehicle_id", "vehicles"] : ["mission_id", "missions"];
        await client.query(`ALTER TABLE treasury_entries DROP CONSTRAINT ${conname}, ADD CONSTRAINT ${conname} FOREIGN KEY (${ref[0]}) REFERENCES ${ref[1]}(id)`);
      }
      expect((await fks()).every((r) => r.confdeltype === "a")).toBe(true);
      await client.query(SQL);
      expect(await fks()).toEqual(before);
      await client.query(SQL);
      expect(await fks()).toEqual(before);

      // Suppression d'un véhicule lié (restauration de sauvegarde) : l'écriture reste, le lien passe à NULL.
      const { rows: [vehicle] } = await client.query(
        `INSERT INTO vehicles (registration_number, brand, model, year) VALUES ('TRECON-V', 'x', 'y', 2020) RETURNING id`,
      );
      const { rows: [account] } = await client.query(`INSERT INTO treasury_accounts (code, label, kind) VALUES ('TRECON3', 'x', 'cash') RETURNING id`);
      const { rows: [entry] } = await client.query(
        `INSERT INTO treasury_entries (account_id, entry_date, label, direction, amount, vehicle_id) VALUES ($1, '2026-11-05', 'x', 'out', 1, $2) RETURNING id`,
        [account.id, vehicle.id],
      );
      await client.query(`DELETE FROM vehicles WHERE id = $1`, [vehicle.id]);
      const { rows: [after] } = await client.query(`SELECT vehicle_id FROM treasury_entries WHERE id = $1`, [entry.id]);
      expect(after.vehicle_id).toBeNull();
    });
  });

  it("table verrouillée par une autre session : WARNING sous 5 s, démarrage non bloqué ; corrigé au passage suivant", async () => {
    // Seul cas hors transaction annulée : le verrou doit venir d'une autre session, donc l'état à réparer
    // est validé en base. Le bloc lui-même le répare à la fin (et au pire, au démarrage suivant).
    const fkBlock = TREASURY_SCHEMA_STATEMENTS.find((s) => s.includes("confdeltype <> 'n'"))!;
    const indexBlock = TREASURY_SCHEMA_STATEMENTS.find((s) => s.includes("CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_accounts_active_fuel_card"))!;
    expect(fkBlock).toBeTruthy();
    expect(indexBlock).toBeTruthy();
    const runner = await pool.connect();
    const holder = await pool.connect();
    const notices: string[] = [];
    runner.on("notice", (n: { message?: string }) => notices.push(String(n.message ?? "")));
    const vehicleFk = async () =>
      (
        await runner.query(
          `SELECT k.confdeltype FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
           WHERE k.conrelid = 'treasury_entries'::regclass AND k.contype = 'f' AND a.attname = 'vehicle_id'`,
        )
      ).rows[0].confdeltype;
    const index = async () => (await runner.query(`SELECT to_regclass('uq_treasury_accounts_active_fuel_card') AS r`)).rows[0].r;
    try {
      const { rows: [fk] } = await runner.query(
        `SELECT k.conname FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
         WHERE k.conrelid = 'treasury_entries'::regclass AND k.contype = 'f' AND a.attname = 'vehicle_id'`,
      );
      await runner.query(`ALTER TABLE treasury_entries DROP CONSTRAINT ${fk.conname}, ADD CONSTRAINT ${fk.conname} FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)`);
      await runner.query(`DROP INDEX IF EXISTS uq_treasury_accounts_active_fuel_card`);
      // Une lecture ouverte sur treasury_entries bloque le DROP CONSTRAINT ; une écriture ouverte sur
      // treasury_accounts bloque le CREATE INDEX.
      await holder.query("BEGIN");
      await holder.query("SELECT 1 FROM treasury_entries LIMIT 1");
      await holder.query("LOCK TABLE treasury_accounts IN ROW EXCLUSIVE MODE");

      const started = Date.now();
      await runner.query(fkBlock);
      await runner.query(indexBlock);
      expect(Date.now() - started).toBeLessThan(20_000);
      expect(await vehicleFk()).toBe("a");
      expect(await index()).toBeNull();
      expect(notices.filter((m) => m.includes("verrou de table indisponible sous 5 s"))).toHaveLength(2);

      await holder.query("ROLLBACK");
      await runner.query(fkBlock);
      await runner.query(indexBlock);
      expect(await vehicleFk()).toBe("n");
      expect(await index()).not.toBeNull();
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
      await runner.query(fkBlock).catch(() => undefined);
      await runner.query(indexBlock).catch(() => undefined);
      runner.release();
    }
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
