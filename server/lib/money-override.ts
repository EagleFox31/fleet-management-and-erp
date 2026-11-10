import { sql } from "drizzle-orm";
import { moduleLogger } from "./logger";

const log = moduleLogger("money-override");

/** Exécuteur Drizzle d'une transaction (`db.transaction(async (tx) => ...)`). */
type Tx = { execute: (query: ReturnType<typeof sql>) => PromiseLike<unknown> };

/**
 * Lève, pour la seule transaction en cours, les verrous d'argent (plein validé, facture
 * ou avoir émis). `set_config(..., true)` borne le réglage à la transaction : il disparaît
 * au COMMIT ou au ROLLBACK, et ne touche aucune autre connexion du pool.
 * Le motif est obligatoire : il est journalisé.
 */
export async function withMoneyOverride(tx: Tx, reason: string): Promise<void> {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (!trimmed) throw new Error("withMoneyOverride : motif obligatoire");
  await tx.execute(sql`select set_config('fleetos.allow_money_override', 'on', true)`);
  log.warn({ reason: trimmed }, "verrous d'argent levés pour la transaction");
}
