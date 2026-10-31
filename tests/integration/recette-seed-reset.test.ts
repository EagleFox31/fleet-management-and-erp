import { beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { seedRecetteData } from "../../scripts/lib/recette-data";

/**
 * Reset puis comptage des lignes possédées par le seed (RCT-% / recette_%).
 * Ne touche aucune autre ligne : la base de test est la base de dev partagée.
 */
const COUNTS: Record<string, string> = {
  users: `SELECT count(*) FROM users WHERE username LIKE 'recette\\_%'`,
  vehicles: `SELECT count(*) FROM vehicles WHERE registration_number LIKE 'RCT-%'`,
  parts: `SELECT count(*) FROM parts WHERE reference LIKE 'RCT-%'`,
  tires: `SELECT count(*) FROM tires WHERE model LIKE 'RCT-%'`,
  suppliers: `SELECT count(*) FROM suppliers WHERE name LIKE 'RCT-%'`,
  clients: `SELECT count(*) FROM clients WHERE name LIKE 'RCT-%'`,
  work_orders: `SELECT count(*) FROM work_orders WHERE vehicle_id IN (SELECT id FROM vehicles WHERE registration_number LIKE 'RCT-%')`,
  part_requirements: `SELECT count(*) FROM part_requirements WHERE vehicle_id IN (SELECT id FROM vehicles WHERE registration_number LIKE 'RCT-%')`,
  fuel_records: `SELECT count(*) FROM fuel_records WHERE vehicle_id IN (SELECT id FROM vehicles WHERE registration_number LIKE 'RCT-%')`,
  invoices: `SELECT count(*) FROM client_invoices WHERE invoice_number LIKE 'RCT-%'`,
  documents: `SELECT count(*) FROM vehicle_documents WHERE vehicle_id IN (SELECT id FROM vehicles WHERE registration_number LIKE 'RCT-%')`,
  time_tracking: `SELECT count(*) FROM time_tracking WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'recette\\_%')`,
  alerts: `SELECT count(*) FROM alerts WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'recette\\_%')`,
};

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [k, sql] of Object.entries(COUNTS)) out[k] = Number((await pool.query(sql)).rows[0].count);
  return out;
}

const EXPECTED = {
  users: 11, vehicles: 12, parts: 5, tires: 3, suppliers: 2, clients: 2, work_orders: 6,
  part_requirements: 6, fuel_records: 3, invoices: 2, documents: 9, time_tracking: 21, alerts: 3,
};

describe("seed et reset de recette", { timeout: 180_000 }, () => {
  let foreignBefore: number;

  beforeAll(async () => {
    process.env.APP_ENV = "recette";
    process.env.RECETTE_DB_HOST_ALLOW = new URL(process.env.DATABASE_URL as string).hostname;
    process.env.RECETTE_PASSWORD = "mot-de-passe-de-test-12";
    process.env.RECETTE_PIN = "4321";
    foreignBefore = Number((await pool.query(`SELECT count(*) FROM vehicles WHERE registration_number NOT LIKE 'RCT-%'`)).rows[0].count);
  });

  it("compte exactement les lignes attendues après reset, sans toucher le reste", async () => {
    const { resetRecette } = await import("../../scripts/recette-reset");
    await resetRecette({ closePool: false });
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    const ws = (await import("ws")).default;
    neonConfig.webSocketConstructor = ws;
    const fresh = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const out: Record<string, number> = {};
      for (const [k, sql] of Object.entries(COUNTS)) out[k] = Number((await fresh.query(sql)).rows[0].count);
      expect(out).toEqual(EXPECTED);
      const foreignAfter = Number((await fresh.query(`SELECT count(*) FROM vehicles WHERE registration_number NOT LIKE 'RCT-%'`)).rows[0].count);
      expect(foreignAfter).toBe(foreignBefore);
      const pin = (await fresh.query(`SELECT pin FROM users WHERE username = 'recette_chauffeur'`)).rows[0].pin;
      expect(pin).toMatch(/^\$2[aby]\$/);
      // idempotence : un second passage des données n'ajoute rien
      await seedRecetteData(fresh as never, { pinHash: null });
      const again: Record<string, number> = {};
      for (const [k, sql] of Object.entries(COUNTS)) again[k] = Number((await fresh.query(sql)).rows[0].count);
      expect(again).toEqual(EXPECTED);
      // échéances J+10 / J+29 / J+31
      const exp = await fresh.query(
        `SELECT DISTINCT (expiry_date - current_date) AS d FROM vehicle_documents WHERE vehicle_id IN (SELECT id FROM vehicles WHERE registration_number LIKE 'RCT-%') ORDER BY 1`,
      );
      expect(exp.rows.map((r) => Number(r.d))).toEqual([10, 29, 31]);
    } finally {
      await fresh.end();
    }
  });
});
