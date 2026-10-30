/**
 * Reset de recette (T-26b) : retire seulement ce que le seed possède (comptes `recette_*`,
 * véhicules `RCT-*` et leurs OT), puis relance le seed. Jamais de TRUNCATE : la base peut
 * contenir des données qui ne sont pas au seed.
 */
import { assertRecetteEnvironment } from "./lib/recette-guard";
import { seedRecette } from "./recette-seed";

export async function resetRecette(): Promise<void> {
  assertRecetteEnvironment();
  const started = Date.now();
  const { pool } = await import("../server/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM work_orders WHERE vehicle_id IN (SELECT id FROM vehicles WHERE registration_number LIKE 'RCT-%')`);
    await client.query(`DELETE FROM vehicles WHERE registration_number LIKE 'RCT-%'`);
    await client.query(`DELETE FROM notification_preferences WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'recette\\_%')`);
    await client.query(`DELETE FROM users WHERE username LIKE 'recette\\_%'`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await seedRecette();
  console.info(`Reset de recette terminé en ${Date.now() - started} ms.`);
}

if (process.argv[1] && /recette-reset\.ts$/.test(process.argv[1])) {
  resetRecette().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
