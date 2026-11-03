import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../server/db";
import { CDC_SCHEMA_STATEMENTS, initializeDatabase } from "../../server/init-database";

// Schéma CDC (lot DB-1). Toute écriture de ce fichier a lieu dans une transaction annulée
// ou sur une table temporaire : rien ne reste en base partagée.

const TABLES = [
  "workshop_labor_rates", "import_batches", "idempotency_keys", "work_orders", "vehicles", "parts", "users",
];

const CDC_SQL = CDC_SCHEMA_STATEMENTS.map((statement) => `${statement};`).join("\n");

// Écritures de la transaction courante, sur la connexion qui les fait : compteurs exacts,
// sans dépendre du vidage asynchrone de pg_stat_user_tables (propre à chaque session).
async function xactWrites(client: PoolClient) {
  const { rows } = await client.query(
    `SELECT c.relname, pg_stat_get_xact_tuples_inserted(c.oid) AS ins,
            pg_stat_get_xact_tuples_updated(c.oid) AS upd, pg_stat_get_xact_tuples_deleted(c.oid) AS del
     FROM pg_class c WHERE c.relkind = 'r' AND c.relnamespace = current_schema()::regnamespace
       AND c.relname = ANY($1) ORDER BY c.relname`,
    [TABLES],
  );
  return rows.map((r) => `${r.relname}:${r.ins}/${r.upd}/${r.del}`);
}

async function sqlState(client: PoolClient, statement: string, params: unknown[] = []) {
  await client.query("SAVEPOINT cdc_case");
  try {
    await client.query(statement, params);
    await client.query("RELEASE SAVEPOINT cdc_case");
    return { code: "ok", constraint: undefined as string | undefined };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT cdc_case");
    const e = error as { code?: string; constraint?: string };
    return { code: e.code ?? "unknown", constraint: e.constraint };
  }
}

describe("schéma CDC : création et idempotence", { timeout: 120_000 }, () => {
  it("crée les tables, colonnes et index attendus", async () => {
    await initializeDatabase();
    const tables = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = current_schema()
       AND tablename IN ('workshop_labor_rates', 'import_batches', 'idempotency_keys') ORDER BY 1`,
    );
    expect(tables.rows.map((r) => r.tablename)).toEqual(["idempotency_keys", "import_batches", "workshop_labor_rates"]);
    const columns = await pool.query(
      `SELECT table_name || '.' || column_name AS c FROM information_schema.columns WHERE table_schema = current_schema()
       AND ((table_name = 'work_orders' AND column_name IN ('due_date', 'due_mileage', 'origin', 'external_ref', 'import_fingerprint', 'import_batch_id'))
         OR (table_name = 'vehicles' AND column_name = 'import_batch_id'))`,
    );
    expect(columns.rows).toHaveLength(7);
    const indexes = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ANY($1)`,
      [[
        "parts_reference_key_idx", "work_orders_preventive_due_idx", "import_batches_applied_file_uidx",
        "work_orders_external_ref_uidx", "work_orders_import_fingerprint_uidx", "idempotency_keys_expires_at_idx",
      ]],
    );
    expect(indexes.rows).toHaveLength(6);
    const registration = await pool.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema()
       AND indexname IN ('vehicles_registration_key_uidx', 'vehicles_registration_key_idx')`,
    );
    expect(registration.rows.map((r) => r.indexname)).toEqual(["vehicles_registration_key_idx"]);
    expect(registration.rows[0].indexdef).not.toMatch(/UNIQUE/);
    const rates = await pool.query(`SELECT count(*)::int AS n FROM workshop_labor_rates`);
    expect(rates.rows[0].n).toBeGreaterThanOrEqual(0);
  });

  it("rejouer le schéma n'écrit aucune ligne (mesure sur une connexion dédiée)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const before = await xactWrites(client);
      await client.query(CDC_SQL);
      expect(await xactWrites(client)).toEqual(before);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("la reprise de due_date ne s'exécute qu'au passage qui crée la colonne", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const v = await client.query(
        `INSERT INTO vehicles (registration_number, brand, model, year) VALUES ('TEST-CDC-DUE-1', 'T', 'T', 2020) RETURNING id`,
      );
      const wo = await client.query(
        `INSERT INTO work_orders (vehicle_id, title, is_preventive, start_date)
         VALUES ($1, 'TEST-CDC préventif', true, now()) RETURNING id`,
        [v.rows[0].id],
      );
      await client.query(CDC_SQL);
      const row = await client.query(`SELECT due_date FROM work_orders WHERE id = $1`, [wo.rows[0].id]);
      expect(row.rows[0].due_date).toBeNull();
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});

// Base poussée par drizzle-kit avant que Drizzle déclare ces contraintes (lot C1) :
// le démarrage doit les reposer, sans écrire de ligne ni bloquer sur des doublons.
describe("schéma CDC : réconciliation des contraintes", { timeout: 60_000 }, () => {
  const CONSTRAINTS: Array<[string, string]> = [
    ["workshop_labor_rates", "workshop_labor_rates_effective_from_key"],
    ["workshop_labor_rates", "workshop_labor_rates_hourly_rate_ht_check"],
    ["import_batches", "import_batches_kind_check"],
    ["import_batches", "import_batches_status_check"],
    ["idempotency_keys", "idempotency_keys_state_check"],
    ["idempotency_keys", "idempotency_keys_user_id_key_key"],
  ];
  const names = CONSTRAINTS.map(([, name]) => name);

  async function present(client: PoolClient) {
    const { rows } = await client.query(
      `SELECT conname FROM pg_constraint WHERE conname = ANY($1) ORDER BY conname`, [names],
    );
    return rows.map((r) => r.conname);
  }

  async function withClient(run: (client: PoolClient) => Promise<void>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await run(client);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  }

  it("repose les CHECK et UNIQUE absents, sans écrire de ligne", async () => {
    await withClient(async (client) => {
      for (const [table, name] of CONSTRAINTS) await client.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
      expect(await present(client)).toEqual([]);
      const before = await xactWrites(client);
      await client.query(CDC_SQL);
      expect(await present(client)).toEqual([...names].sort());
      expect(await xactWrites(client)).toEqual(before);
      expect(await sqlState(client, `INSERT INTO workshop_labor_rates (effective_from, hourly_rate_ht) VALUES ('2099-01-01', -1)`))
        .toEqual({ code: "23514", constraint: "workshop_labor_rates_hourly_rate_ht_check" });
    });
  });

  it("renomme une unicité posée sous un autre nom sur les mêmes colonnes", async () => {
    await withClient(async (client) => {
      await client.query(`ALTER TABLE idempotency_keys DROP CONSTRAINT idempotency_keys_user_id_key_key`);
      await client.query(`ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_legacy_uq UNIQUE (user_id, key)`);
      await client.query(CDC_SQL);
      const { rows } = await client.query(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'idempotency_keys'::regclass AND contype = 'u'`,
      );
      expect(rows.map((r) => r.conname)).toEqual(["idempotency_keys_user_id_key_key"]);
    });
  });

  it("des doublons existants laissent l'unicité absente sans bloquer le démarrage", async () => {
    await withClient(async (client) => {
      await client.query(`ALTER TABLE workshop_labor_rates DROP CONSTRAINT workshop_labor_rates_effective_from_key`);
      await client.query(
        `INSERT INTO workshop_labor_rates (effective_from, hourly_rate_ht) VALUES ('2099-01-01', 1), ('2099-01-01', 2)`,
      );
      expect((await sqlState(client, CDC_SQL)).code).toBe("ok");
      expect(await present(client)).not.toContain("workshop_labor_rates_effective_from_key");
    });
  });
});

describe("schéma CDC : invariants (cas accepté, cas refusé)", { timeout: 60_000 }, () => {
  let client: PoolClient;
  let userId: number;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query("BEGIN");
    const u = await client.query(`SELECT id FROM users ORDER BY id LIMIT 1`);
    userId = u.rows[0].id;
  });

  afterAll(async () => {
    await client.query("ROLLBACK");
    client.release();
  });

  it("import_batches : un fichier appliqué une seule fois, un échec ne bloque pas", async () => {
    const insert = `INSERT INTO import_batches (kind, file_sha256, status) VALUES ($1, 'TEST-CDC-sha', $2)`;
    expect((await sqlState(client, insert, ["vehicles", "applied"])).code).toBe("ok");
    expect((await sqlState(client, insert, ["vehicles", "failed"])).code).toBe("ok");
    expect((await sqlState(client, insert, ["interventions", "applied"])).code).toBe("ok");
    expect(await sqlState(client, insert, ["vehicles", "applied"])).toEqual({
      code: "23505", constraint: "import_batches_applied_file_uidx",
    });
    expect((await sqlState(client, insert, ["drivers", "applied"])).code).toBe("23514");
  });

  it("workshop_labor_rates : taux négatif et date en double refusés", async () => {
    const insert = `INSERT INTO workshop_labor_rates (effective_from, hourly_rate_ht) VALUES (DATE '1999-01-01', $1)`;
    expect((await sqlState(client, insert, [-1])).code).toBe("23514");
    expect((await sqlState(client, insert, [0])).code).toBe("ok");
    expect((await sqlState(client, insert, [15000])).code).toBe("23505");
  });

  it("work_orders : due_mileage négatif refusé, external_ref et empreinte uniques", async () => {
    const v = await client.query(
      `INSERT INTO vehicles (registration_number, brand, model, year) VALUES ('TEST-CDC-WO-1', 'T', 'T', 2020) RETURNING id`,
    );
    const insert = `INSERT INTO work_orders (vehicle_id, title, due_mileage, external_ref, import_fingerprint, origin)
                    VALUES ($1, 'TEST-CDC', $2, $3, $4, 'history_import')`;
    expect(await sqlState(client, insert, [v.rows[0].id, -5, null, null])).toEqual({
      code: "23514", constraint: "work_orders_due_mileage_check",
    });
    expect((await sqlState(client, insert, [v.rows[0].id, 1000, "TEST-CDC-EXT", "TEST-CDC-FP"])).code).toBe("ok");
    expect(await sqlState(client, insert, [v.rows[0].id, 1000, "TEST-CDC-EXT", "TEST-CDC-FP2"])).toEqual({
      code: "23505", constraint: "work_orders_external_ref_uidx",
    });
    expect(await sqlState(client, insert, [v.rows[0].id, 1000, null, "TEST-CDC-FP"])).toEqual({
      code: "23505", constraint: "work_orders_import_fingerprint_uidx",
    });
    expect((await sqlState(client, insert, [v.rows[0].id, null, null, null])).code).toBe("ok");
  });

  it("vehicles : l'index d'immatriculation n'impose pas l'unicité (contrôle applicatif au lot #9)", async () => {
    const insert = `INSERT INTO vehicles (registration_number, brand, model, year) VALUES ($1, 'T', 'T', 2020)`;
    expect((await sqlState(client, insert, ["TEST-CDC 77 AB"])).code).toBe("ok");
    expect((await sqlState(client, insert, ["testcdc77ab"])).code).toBe("ok");
  });

  it("idempotency_keys : une clé par utilisateur, expiration par défaut à 7 jours", async () => {
    const insert = `INSERT INTO idempotency_keys (user_id, key, method, path, request_hash) VALUES ($1, 'TEST-CDC-KEY', 'POST', '/x', 'h')`;
    expect((await sqlState(client, insert, [userId])).code).toBe("ok");
    expect((await sqlState(client, insert, [userId])).code).toBe("23505");
    const row = await client.query(
      `SELECT state, round(extract(epoch FROM expires_at - created_at) / 86400) AS days FROM idempotency_keys WHERE key = 'TEST-CDC-KEY'`,
    );
    expect(row.rows[0]).toEqual({ state: "in_progress", days: "7" });
  });
});

describe("trigger temps réel : garde fleetos.suppress_side_effects", { timeout: 60_000 }, () => {
  // Table temporaire (propre à la session) branchée sur la vraie fonction : aucune ligne partagée.
  // Le cas « sans variable » émet un seul événement work_order_created d'id fictif (-424242)
  // sur fleet_events : un serveur de dev qui écoute le rediffuse en WebSocket (server/index.ts).
  it("sans la variable l'événement part, avec 'on' il ne part pas", async () => {
    const listener = await pool.connect();
    const writer = await pool.connect();
    const received: string[] = [];
    try {
      listener.on("notification", (msg) => {
        if (msg.payload?.includes("-424242")) received.push(msg.payload);
      });
      await listener.query("LISTEN fleet_events");
      await writer.query(`CREATE TEMP TABLE cdc_wo_probe (LIKE work_orders INCLUDING DEFAULTS)`);
      await writer.query(
        `CREATE TRIGGER cdc_wo_probe_notify AFTER INSERT ON cdc_wo_probe FOR EACH ROW EXECUTE FUNCTION notify_work_orders_realtime()`,
      );
      const probe = `INSERT INTO cdc_wo_probe (id, vehicle_id, title) VALUES (-424242, -424242, 'TEST-CDC probe')`;

      await writer.query("BEGIN");
      await writer.query(`SELECT set_config('fleetos.suppress_side_effects', 'on', true)`);
      await writer.query(probe);
      await writer.query("COMMIT");
      await new Promise((r) => setTimeout(r, 1500));
      expect(received).toHaveLength(0);

      await writer.query("DELETE FROM cdc_wo_probe");
      await writer.query(probe);
      await new Promise((r) => setTimeout(r, 1500));
      expect(received.length).toBeGreaterThanOrEqual(1);
    } finally {
      await listener.query("UNLISTEN fleet_events").catch(() => undefined);
      await writer.query("DROP TABLE IF EXISTS cdc_wo_probe").catch(() => undefined);
      listener.release();
      writer.release();
    }
  });
});
