import { describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { initializeDatabase } from "../../server/init-database";

/**
 * P3-2 : colonnes du récépissé de renouvellement et contrainte document_renewal_requests_receipt_complete.
 * Les écritures de test se font dans une transaction annulée : aucune ligne ne reste en base.
 */

const RECEIPT_COLUMNS = [
  "receipt_file_name",
  "receipt_file_path",
  "receipt_uploaded_at",
  "receipt_uploaded_by",
  "receipt_valid_until",
];

async function catalog() {
  const { rows: columns } = await pool.query(
    `SELECT a.attname, a.attnum, a.atttypid::regtype::text AS type, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS default_expr
       FROM pg_attribute a
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'document_renewal_requests'::regclass AND a.attname = ANY($1) AND NOT a.attisdropped
      ORDER BY a.attname`,
    [RECEIPT_COLUMNS],
  );
  const { rows: constraints } = await pool.query(
    `SELECT conname, oid::text, convalidated, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conrelid = 'document_renewal_requests'::regclass AND conname LIKE '%receipt%'
      ORDER BY conname`,
  );
  return { columns, constraints };
}

async function renewalCounters() {
  await pool.query("SELECT pg_stat_force_next_flush()").catch(() => undefined);
  const { rows } = await pool.query(
    `SELECT n_tup_ins, n_tup_upd, n_tup_del FROM pg_stat_user_tables WHERE relname = 'document_renewal_requests'`,
  );
  return rows[0];
}

describe("P3-2 : récépissé de renouvellement en base", { timeout: 120_000 }, () => {
  it("crée les cinq colonnes nullable, sans défaut, et les deux contraintes validées", async () => {
    await initializeDatabase();
    const { columns, constraints } = await catalog();
    expect(columns.map((c) => [c.attname, c.type, c.attnotnull, c.default_expr])).toEqual([
      ["receipt_file_name", "text", false, null],
      ["receipt_file_path", "text", false, null],
      ["receipt_uploaded_at", "timestamp without time zone", false, null],
      ["receipt_uploaded_by", "integer", false, null],
      ["receipt_valid_until", "date", false, null],
    ]);
    expect(constraints.map((c) => [c.conname, c.convalidated, c.def])).toEqual([
      [
        "document_renewal_requests_receipt_complete",
        true,
        "CHECK (((receipt_valid_until IS NULL) = (receipt_file_path IS NULL)))",
      ],
      [
        "document_renewal_requests_receipt_uploaded_by_users_id_fk",
        true,
        "FOREIGN KEY (receipt_uploaded_by) REFERENCES users(id)",
      ],
    ]);
  });

  it("accepte une demande sans récépissé ou avec date et fichier, refuse l'un sans l'autre", async () => {
    const client = await pool.connect();
    const outcomes: Array<{ cas: string; code?: string; constraint?: string }> = [];
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
      const insert = (valid: string | null, path: string | null) =>
        client.query(
          `INSERT INTO document_renewal_requests
             (vehicle_id, vehicle_document_id, document_type, status, receipt_valid_until, receipt_file_path, receipt_file_name)
           VALUES ($1, $2, 'assurance', 'in_progress', $3::date, $4, $5) RETURNING receipt_valid_until, receipt_uploaded_by`,
          [vehicleId, docs[0].id, valid, path, path ? "recu.pdf" : null],
        );

      const none = await insert(null, null);
      expect(none.rows[0]).toMatchObject({ receipt_valid_until: null, receipt_uploaded_by: null });
      const full = await insert("2026-12-31", "/uploads/document-renewals/receipts/recu.pdf");
      expect(full.rowCount).toBe(1);

      for (const [cas, valid, path] of [
        ["date sans fichier", "2026-12-31", null],
        ["fichier sans date", null, "/uploads/document-renewals/receipts/recu.pdf"],
      ] as const) {
        await client.query("SAVEPOINT essai");
        try {
          await insert(valid, path);
          outcomes.push({ cas, code: "accepté" });
        } catch (error) {
          const pgError = error as { code?: string; constraint?: string };
          outcomes.push({ cas, code: pgError.code, constraint: pgError.constraint });
        }
        await client.query("ROLLBACK TO SAVEPOINT essai");
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    expect(outcomes).toEqual([
      { cas: "date sans fichier", code: "23514", constraint: "document_renewal_requests_receipt_complete" },
      { cas: "fichier sans date", code: "23514", constraint: "document_renewal_requests_receipt_complete" },
    ]);
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
