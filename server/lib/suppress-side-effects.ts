import { sql } from "drizzle-orm";

/**
 * Coupe les effets secondaires des triggers (alertes carburant, alertes de planning, rattrapage
 * préventif) pour la transaction en cours : `SET LOCAL fleetos.suppress_side_effects = 'on'`.
 *
 * À réserver aux reprises d'historique (restauration de sauvegarde, import, seed) : chaque plein
 * repris déclencherait sinon une alerte, et une sauvegarde qui contient déjà ces alertes violerait
 * `uq_alerts_user_dedupe` (23505). Portée transactionnelle : rien ne fuit hors de la transaction,
 * ni vers une autre requête du pool.
 */
export async function suppressSideEffects(tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> }): Promise<void> {
  await tx.execute(sql`SELECT set_config('fleetos.suppress_side_effects', 'on', true)`);
}
