import type { EventEmitter } from "node:events";
import { moduleLogger } from "./logger";

type PoolErrorLogger = Pick<ReturnType<typeof moduleLogger>, "error">;

/**
 * Journalise les erreurs d'une connexion au repos au lieu d'arrêter le processus.
 *
 * pg-pool émet `error` quand une connexion inactive casse (redémarrage de la base, coupure réseau).
 * Sans écouteur, Node lève l'erreur et le processus s'arrête. Le pool a déjà retiré la connexion
 * fautive : la prochaine requête en ouvre une neuve, il n'y a rien d'autre à faire.
 */
export function logPoolErrors(
  pool: Pick<EventEmitter, "on">,
  name: string,
  log: PoolErrorLogger = moduleLogger("db"),
): void {
  pool.on("error", (err: unknown) => {
    log.error({ err, pool: name }, "Connexion Postgres au repos perdue ; le pool en ouvrira une neuve.");
  });
}
