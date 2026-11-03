import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pool } from "../../server/db";

/**
 * Garde-fou du ménage des comptes de test (`tests/support/cleanup.ts`) : une clé étrangère
 * vers `users` sans `ON DELETE` bloque la suppression d'un compte de test qui a écrit dans la
 * table. `cleanupOrphanTestRows` tourne dans le hook global de chaque fichier : une FK oubliée
 * fait échouer des fichiers dont tous les tests passent (cas réels : alerts, missions,
 * document_renewal_centers, status_history).
 *
 * Chaque FK bloquante vers `users` doit être :
 * - traitée par compte : `inArray(<table>.<colonne>, testUsers)` dans `deleteOrphanTestRows` ;
 * - ou portée par une table vidée par préfixe (`orphan(<table>.…)`), dont les lignes de test
 *   partent avant les comptes ;
 * - ou figurer dans `NOT_YET_HANDLED`, liste gelée par égalité stricte : elle ne peut que
 *   diminuer. Une FK nouvelle fait échouer ce test, qui force la décision.
 */

const CLEANUP = readFileSync("tests/support/cleanup.ts", "utf8");
const ORPHAN_BODY = CLEANUP.slice(CLEANUP.indexOf("async function deleteOrphanTestRows"));

const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * FK bloquantes non traitées au 3 novembre 2026 (36 sur 59). Elles ne bloquent que si un compte
 * de test écrit une ligne sans préfixe TEST dans la table : une seule a déjà cassé le hook global.
 * Retirer une entrée dès qu'elle est traitée par compte dans `deleteOrphanTestRows`.
 */
const NOT_YET_HANDLED: string[] = [
  "client_payments.recorded_by",
  "document_renewal_requests.receipt_uploaded_by",
  "drivers.user_id",
  "fault_catalog.created_by",
  "fault_catalog.validated_by",
  "fuel_anomaly_resolutions.resolved_by",
  "import_batches.created_by",
  "incidents.created_by",
  "incidents.reported_by",
  "incidents.updated_by",
  "labor_catalog.created_by",
  "labor_catalog.updated_by",
  "missions.validated_by",
  "monthly_time_stats.user_id",
  "part_requirements.received_by",
  "part_requirements.requested_by",
  "parts_stock_movements.created_by",
  "purchase_orders.approved_by",
  "purchase_orders.created_by",
  "supplier_invoice_settlements.reconciled_by",
  "supplier_invoice_settlements.recorded_by",
  "supplier_invoice_settlements.rejected_by",
  "time_tracking.user_id",
  "tire_inspections.inspected_by",
  "tire_rotations.performed_by",
  "tires.created_by",
  "tires.updated_by",
  "vehicle_documents.updated_by",
  "vehicle_documents.uploaded_by",
  "work_order_items.created_by",
  "work_orders.created_by",
  "work_orders.qc_by",
  "work_orders.technician_id",
  "work_orders.updated_by",
  "workflow_documents.uploaded_by",
  "workshop_labor_rates.created_by",
];

async function blockingUserForeignKeys(): Promise<string[]> {
  const { rows } = await pool.query<{ fk: string }>(
    `SELECT c.conrelid::regclass::text || '.' || a.attname AS fk
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass AND c.confdeltype IN ('a', 'r')
      ORDER BY 1`,
  );
  return rows.map((row) => row.fk);
}

function handledBy(fk: string): "compte" | "préfixe" | null {
  const [table, column] = fk.split(".");
  const ref = `${camel(table)}.${camel(column)}`;
  if (new RegExp(String.raw`inArray\(${ref.replace(".", "\.")},\s*testUsers\)`).test(ORPHAN_BODY)) return "compte";
  if (new RegExp(String.raw`orphan\(${camel(table)}\.`).test(ORPHAN_BODY)) return "préfixe";
  return null;
}

describe("ménage des comptes de test : clés étrangères vers users", () => {
  it("le catalogue renvoie les FK bloquantes vers users", async () => {
    const fks = await blockingUserForeignKeys();
    expect(fks.length).toBeGreaterThan(40);
    expect(fks).toContain("status_history.updated_by_id");
  });

  it("chaque FK bloquante est traitée, ou gelée dans NOT_YET_HANDLED", async () => {
    const unhandled = (await blockingUserForeignKeys()).filter((fk) => handledBy(fk) === null);
    expect(unhandled).toEqual([...NOT_YET_HANDLED].sort());
  });

  it("les cas déjà rencontrés sont traités par compte", () => {
    for (const fk of ["alerts.user_id", "missions.created_by", "document_renewal_centers.created_by", "status_history.updated_by_id"]) {
      expect(handledBy(fk)).toBe("compte");
    }
  });
});
