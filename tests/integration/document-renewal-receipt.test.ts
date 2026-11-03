import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { pool } from "../../server/db";
import {
  DOCUMENT_RENEWAL_RECEIPT_SQL,
  initializeDatabase,
  reportDocumentRenewalReceiptGaps,
} from "../../server/init-database";

/**
 * P3-2 : colonnes du récépissé de renouvellement et contraintes
 * document_renewal_requests_receipt_complete / document_renewal_requests_receipt_uploaded_by_users_id_fk.
 * Les écritures de test, DDL compris, se font dans une transaction annulée : rien ne reste en base.
 */

const CHECK = "document_renewal_requests_receipt_complete";
const FK = "document_renewal_requests_receipt_uploaded_by_users_id_fk";
const OLD_CHECK_DEF = "(receipt_valid_until IS NULL) = (receipt_file_path IS NULL)";
const RECEIPT_COLUMNS = [
  "receipt_file_name",
  "receipt_file_path",
  "receipt_uploaded_at",
  "receipt_uploaded_by",
  "receipt_valid_until",
];

type Querier = Pick<PoolClient, "query"> | typeof pool;

async function constraints(q: Querier = pool) {
  const { rows } = await q.query(
    `SELECT conname, oid::text, convalidated, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conrelid = 'document_renewal_requests'::regclass AND conname LIKE '%receipt%'
      ORDER BY conname`,
  );
  return rows as Array<{ conname: string; oid: string; convalidated: boolean; def: string }>;
}

async function catalog() {
  const { rows: columns } = await pool.query(
    `SELECT a.attname, a.attnum, a.atttypid::regtype::text AS type, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS default_expr
       FROM pg_attribute a
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'document_renewal_requests'::regclass AND a.attname = ANY($1) AND NOT a.attisdropped
      ORDER BY a.attname`,
    [RECEIPT_COLUMNS],
  );
  return { columns, constraints: await constraints() };
}

async function renewalCounters() {
  await pool.query("SELECT pg_stat_force_next_flush()").catch(() => undefined);
  const { rows } = await pool.query(
    `SELECT n_tup_ins, n_tup_upd, n_tup_del FROM pg_stat_user_tables WHERE relname = 'document_renewal_requests'`,
  );
  return rows[0];
}

type Receipt = { valid?: string | null; path?: string | null; name?: string | null; at?: string | null };
const FULL: Receipt = {
  valid: "2026-12-31",
  path: "/uploads/document-renewals/receipts/recu.pdf",
  name: "recu.pdf",
  at: "2026-11-03 08:00:00",
};

/** Ouvre une transaction, crée un véhicule et un document TEST, passe un insert de demande, annule tout. */
async function inRolledBackTransaction(
  run: (client: PoolClient, insert: (r: Receipt) => Promise<unknown>) => Promise<void>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: vehicles } = await client.query(
      `INSERT INTO vehicles (registration_number, brand, model, year)
       VALUES ($1, 'TEST', 'P32', 2020) RETURNING id`,
      [`TEST-P32-RECU-${Date.now()}`],
    );
    const vehicleId = vehicles[0].id;
    const { rows: docs } = await client.query(
      `INSERT INTO vehicle_documents (vehicle_id, name, type, filename, filesize, file_type, file_path)
       VALUES ($1, 'TEST assurance', 'assurance', 'a.pdf', 1, 'application/pdf', '/uploads/a.pdf') RETURNING id`,
      [vehicleId],
    );
    const insert = (r: Receipt) =>
      client.query(
        `INSERT INTO document_renewal_requests
           (vehicle_id, vehicle_document_id, document_type, status,
            receipt_valid_until, receipt_file_path, receipt_file_name, receipt_uploaded_at)
         VALUES ($1, $2, 'assurance', 'in_progress', $3::date, $4, $5, $6::timestamp)`,
        [vehicleId, docs[0].id, r.valid ?? null, r.path ?? null, r.name ?? null, r.at ?? null],
      );
    await run(client, insert);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

describe("P3-2 : récépissé de renouvellement en base", { timeout: 120_000 }, () => {
  it("crée les cinq colonnes nullable, sans défaut, et les deux contraintes validées", async () => {
    await initializeDatabase();
    const { columns, constraints: found } = await catalog();
    expect(columns.map((c) => [c.attname, c.type, c.attnotnull, c.default_expr])).toEqual([
      ["receipt_file_name", "text", false, null],
      ["receipt_file_path", "text", false, null],
      ["receipt_uploaded_at", "timestamp without time zone", false, null],
      ["receipt_uploaded_by", "integer", false, null],
      ["receipt_valid_until", "date", false, null],
    ]);
    expect(found.map((c) => [c.conname, c.convalidated])).toEqual([
      [CHECK, true],
      [FK, true],
    ]);
    const check = found[0].def;
    for (const column of ["receipt_valid_until", "receipt_file_path", "receipt_file_name", "receipt_uploaded_at"]) {
      expect(check).toContain(column);
    }
    expect(check).not.toContain("receipt_uploaded_by");
    expect(found[1].def).toBe("FOREIGN KEY (receipt_uploaded_by) REFERENCES users(id)");
  });

  it("accepte aucun récépissé ou les quatre champs (auteur NULL admis), refuse tout récépissé incomplet", async () => {
    const outcomes: Array<{ cas: string; code?: string; constraint?: string }> = [];
    await inRolledBackTransaction(async (client, insert) => {
      await insert({});
      await insert(FULL);
      for (const [cas, receipt] of [
        ["date seule", { valid: FULL.valid }],
        ["fichier sans date", { ...FULL, valid: null }],
        ["sans nom de fichier", { ...FULL, name: null }],
        ["sans date de dépôt", { ...FULL, at: null }],
      ] as const) {
        await client.query("SAVEPOINT essai");
        try {
          await insert(receipt);
          outcomes.push({ cas, code: "accepté" });
        } catch (error) {
          const pgError = error as { code?: string; constraint?: string };
          outcomes.push({ cas, code: pgError.code, constraint: pgError.constraint });
        }
        await client.query("ROLLBACK TO SAVEPOINT essai");
      }
    });
    expect(outcomes).toEqual(
      ["date seule", "fichier sans date", "sans nom de fichier", "sans date de dépôt"].map((cas) => ({
        cas,
        code: "23514",
        constraint: CHECK,
      })),
    );
  });

  it("une ligne hors CHECK laisse la CHECK posée NOT VALID, sans toucher la FK, et l'écart est journalisé", async () => {
    await inRolledBackTransaction(async (client, insert) => {
      await client.query(`ALTER TABLE document_renewal_requests DROP CONSTRAINT ${CHECK}`);
      await client.query(`ALTER TABLE document_renewal_requests DROP CONSTRAINT ${FK}`);
      await insert({ valid: FULL.valid });
      await client.query(DOCUMENT_RENEWAL_RECEIPT_SQL);
      expect((await constraints(client)).map((c) => [c.conname, c.convalidated])).toEqual([
        [CHECK, false],
        [FK, true],
      ]);
      // NOT VALID contrôle quand même les écritures suivantes.
      await client.query("SAVEPOINT essai");
      await expect(insert({ valid: FULL.valid })).rejects.toMatchObject({ code: "23514", constraint: CHECK });
      await client.query("ROLLBACK TO SAVEPOINT essai");

      const log = { warn: vi.fn() };
      expect(await reportDocumentRenewalReceiptGaps(client, log)).toEqual({ missing: [], notValidated: [CHECK], outdated: [] });
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn.mock.calls[0][1]).toContain(CHECK);
      expect(log.warn.mock.calls[0][1]).not.toContain(FK);
    });
  });

  it("une ligne hors FK laisse la FK posée NOT VALID, sans toucher la CHECK, et la FK est citée par son nom", async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(`ALTER TABLE document_renewal_requests DROP CONSTRAINT ${CHECK}`);
      await client.query(`ALTER TABLE document_renewal_requests DROP CONSTRAINT ${FK}`);
      const { rows } = await client.query(`SELECT COALESCE(max(id), 0) + 1000 AS ghost FROM users`);
      // Demande TEST dont l'auteur du récépissé n'existe pas : la FK ne peut pas être validée.
      await client.query(
        `INSERT INTO document_renewal_requests (vehicle_id, vehicle_document_id, document_type, receipt_uploaded_by)
         SELECT vehicle_id, id, 'assurance', $1 FROM vehicle_documents WHERE name = 'TEST assurance' ORDER BY id DESC LIMIT 1`,
        [rows[0].ghost],
      );
      await client.query(DOCUMENT_RENEWAL_RECEIPT_SQL);
      expect((await constraints(client)).map((c) => [c.conname, c.convalidated])).toEqual([
        [CHECK, true],
        [FK, false],
      ]);
      const log = { warn: vi.fn() };
      expect(await reportDocumentRenewalReceiptGaps(client, log)).toEqual({ missing: [], notValidated: [FK], outdated: [] });
      expect(log.warn.mock.calls[0][1]).toContain(FK);
      expect(log.warn.mock.calls[0][1]).not.toContain(CHECK);
    });
  });

  it("remplace une CHECK de même nom à l'ancienne définition, puis ne la touche plus", async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(`ALTER TABLE document_renewal_requests DROP CONSTRAINT ${CHECK}`);
      await client.query(`ALTER TABLE document_renewal_requests ADD CONSTRAINT ${CHECK} CHECK (${OLD_CHECK_DEF})`);
      await client.query(DOCUMENT_RENEWAL_RECEIPT_SQL);
      const replaced = (await constraints(client)).find((c) => c.conname === CHECK)!;
      expect(replaced.def).toContain("receipt_uploaded_at");
      expect(replaced.convalidated).toBe(true);
      await client.query(DOCUMENT_RENEWAL_RECEIPT_SQL);
      expect((await constraints(client)).find((c) => c.conname === CHECK)!.oid).toBe(replaced.oid);
      const log = { warn: vi.fn() };
      expect(await reportDocumentRenewalReceiptGaps(client, log)).toEqual({ missing: [], notValidated: [], outdated: [] });
      expect(log.warn).not.toHaveBeenCalled();
    });
  });

  it("ancienne CHECK et lignes hors nouvelle définition : nouvelle CHECK posée NOT VALID et signalée", async () => {
    await inRolledBackTransaction(async (client, insert) => {
      await client.query(`ALTER TABLE document_renewal_requests DROP CONSTRAINT ${CHECK}`);
      await client.query(`ALTER TABLE document_renewal_requests ADD CONSTRAINT ${CHECK} CHECK (${OLD_CHECK_DEF})`);
      await insert({ valid: FULL.valid, path: FULL.path });
      await client.query(DOCUMENT_RENEWAL_RECEIPT_SQL);
      const posed = (await constraints(client)).find((c) => c.conname === CHECK)!;
      expect(posed.def).toContain("receipt_uploaded_at");
      expect(posed.convalidated).toBe(false);
      const log = { warn: vi.fn() };
      expect(await reportDocumentRenewalReceiptGaps(client, log)).toEqual({
        missing: [],
        notValidated: [CHECK],
        outdated: [],
      });
      expect(log.warn).toHaveBeenCalledTimes(1);
    });
  });

  it("un second démarrage ne change ni le catalogue ni les lignes de document_renewal_requests", async () => {
    await initializeDatabase();
    const catalogBefore = await catalog();
    const countersBefore = await renewalCounters();
    await initializeDatabase();
    expect(await catalog()).toEqual(catalogBefore);
    expect(await renewalCounters()).toEqual(countersBefore);
  });
});
