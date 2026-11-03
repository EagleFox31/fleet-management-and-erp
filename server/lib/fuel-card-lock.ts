import { sql } from "drizzle-orm";
import { db } from "../db";

/** Exécuteur Drizzle : la base, ou une transaction en cours. */
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Verrou transactionnel de la carte carburant. La carte est unique et son solde
 * est une somme sur fuel_records : aucune ligne à verrouiller par FOR UPDATE.
 * Toute écriture touchant debit_amount / credit_amount (création, modification,
 * suppression) le prend dans sa transaction ; il est relâché au COMMIT ou au ROLLBACK.
 */
export async function lockFuelCard(tx: DbExecutor): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fleetmaster_fuel_card'))`);
}
