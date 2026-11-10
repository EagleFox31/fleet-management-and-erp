import { inArray, type SQL } from "drizzle-orm";
import { db } from "../../server/db";
import { clientCreditNotes, clientInvoices, fuelRecords } from "../../shared/schema";
import { withMoneyOverride } from "../../server/lib/money-override";
import { moduleLogger } from "../../server/lib/logger";

const log = moduleLogger("tests-money-override");

/**
 * Suppression de pleins et de factures par les tests. Les triggers de verrou d'argent
 * refusent UPDATE et DELETE sur un plein validé ou une facture émise : le nettoyage passe
 * par une transaction qui lève le verrou, et c'est le SEUL endroit de tests/, e2e/ et
 * scripts/ autorisé à le faire (garde : tests/unit/server/money-override-hygiene.test.ts).
 * Les avoirs (`client_credit_notes`, immuables) se suppriment avec leur facture : la clé étrangère est RESTRICT.
 */
const REASON = "nettoyage de données de test";

export async function deleteFuelRecordsWhere(where: SQL): Promise<void> {
  await db.transaction(async (tx) => {
    await withMoneyOverride(tx, REASON);
    await tx.delete(fuelRecords).where(where);
  });
}

export async function deleteClientInvoicesWhere(where: SQL): Promise<void> {
  await db.transaction(async (tx) => {
    await withMoneyOverride(tx, REASON);
    await tx
      .delete(clientCreditNotes)
      .where(inArray(clientCreditNotes.invoiceId, tx.select({ id: clientInvoices.id }).from(clientInvoices).where(where)));
    await tx.delete(clientInvoices).where(where);
  });
}

export async function deleteFuelRecordsForTest(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await deleteFuelRecordsWhere(inArray(fuelRecords.id, ids));
}

export async function deleteClientInvoicesForTest(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await deleteClientInvoicesWhere(inArray(clientInvoices.id, ids));
}

/** Variante SQL brute (pool `pg`) : pleins d'un lot de véhicules. */
export async function deleteFuelRecordsByVehiclesRaw(
  pool: { connect(): Promise<{ query(text: string, values?: unknown[]): Promise<unknown>; release(): void }> },
  vehicleIds: number[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`select set_config('fleetos.allow_money_override', 'on', true)`);
    await client.query(`DELETE FROM fuel_records WHERE vehicle_id = ANY($1)`, [vehicleIds]);
    await client.query("COMMIT");
  } catch (error) {
    // Un ROLLBACK qui échoue ne doit pas masquer l'erreur d'origine : on le journalise et on relance celle-ci.
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      log.error({ err: rollbackError }, "ROLLBACK en échec après une erreur de nettoyage");
    }
    throw error;
  } finally {
    client.release();
  }
}
