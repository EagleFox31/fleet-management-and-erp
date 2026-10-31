import { alertService } from "./services/alert-service";
import { moduleLogger } from "./lib/logger";
import { backupTick } from "./jobs/backup-production";
import { idempotencyPurgeTick } from "./jobs/idempotency-purge";

const log = moduleLogger("scheduler");

/**
 * Ordonnanceur des tâches de fond.
 *
 * Volontairement minimal: `setInterval` en mémoire du processus. Suffisant tant
 * que l'application tourne en instance unique et que les tâches sont le cycle
 * d'alertes et la sauvegarde quotidienne.
 *
 * Limites assumées:
 * - en multi-instance, chaque instance exécuterait le cycle d'alertes (doublons) ;
 *   la sauvegarde, elle, est protégée par un verrou consultatif Postgres ;
 * - un cycle prévu pendant un arrêt du processus est simplement sauté ; la
 *   sauvegarde se rattrape (lancée si la dernière réussite a plus de 24 h).
 *
 * Le jour où il faut des reprises sur échec, un historique auditable ou du
 * multi-instance, basculer sur un ordonnanceur adossé à Postgres (pg-boss,
 * graphile-worker) — pas de Redis à ajouter. `pg_cron` sur Neon est déconseillé:
 * les jobs ne tournent que si le compute est actif, sans réveil sur cron.
 */

const INITIAL_DELAY_MS = 2_000;
const ALERT_CHECK_INTERVAL_MS = 5 * 60 * 1000;
/** Au-delà, le cycle risque de chevaucher le suivant: on le signale. */
const SLOW_CYCLE_THRESHOLD_MS = ALERT_CHECK_INTERVAL_MS * 0.5;
const IDEMPOTENCY_PURGE_INTERVAL_MS = 60 * 60 * 1000;

let schedulerStarted = false;
let alertCycleRunning = false;
let alertCycleSkipped = 0;
let backupTickRunning = false;
let idempotencyPurgeRunning = false;
let idempotencyPurgeLastRunAt = 0;

/**
 * Exécute un cycle d'alertes en interdisant le chevauchement.
 *
 * `setInterval` n'attend pas la fin du tick précédent: sans ce garde, un cycle
 * plus long que l'intervalle en déclencherait un second en parallèle, avec des
 * lectures concurrentes et un risque de doublons malgré `createAlertIfNotExists`.
 */
async function runAlertCycle(reason: string): Promise<void> {
  if (alertCycleRunning) {
    alertCycleSkipped += 1;
    log.warn({ reason, skipped: alertCycleSkipped }, "cycle d'alertes ignoré: le précédent tourne encore");
    return;
  }

  alertCycleRunning = true;
  const startedAt = Date.now();

  try {
    await alertService.runAllAlertChecks();
  } catch (err) {
    log.error({ err, reason }, "cycle d'alertes en échec");
  } finally {
    const durationMs = Date.now() - startedAt;
    alertCycleRunning = false;

    if (durationMs >= SLOW_CYCLE_THRESHOLD_MS) {
      log.warn(
        { durationMs, intervalMs: ALERT_CHECK_INTERVAL_MS },
        "cycle d'alertes lent: surveiller les requêtes N+1",
      );
    } else {
      log.info({ durationMs, reason }, "cycle d'alertes terminé");
    }
  }
}

/** Sauvegarde quotidienne: ne fait rien tant que la dernière réussite a moins de 24 h. */
async function runBackupTick(reason: string): Promise<void> {
  if (backupTickRunning) return;
  backupTickRunning = true;
  try {
    await backupTick();
  } catch (err) {
    log.error({ err, reason }, "tick de sauvegarde en échec");
  } finally {
    backupTickRunning = false;
  }
}

/**
 * Purge des clés d'idempotence, au plus une fois par heure. Sans effet tant que le drapeau
 * `technician-offline` est coupé ou que la table `idempotency_keys` n'existe pas (lot DB-1).
 */
async function runIdempotencyPurgeTick(): Promise<void> {
  if (idempotencyPurgeRunning) return;
  if (Date.now() - idempotencyPurgeLastRunAt < IDEMPOTENCY_PURGE_INTERVAL_MS) return;
  idempotencyPurgeRunning = true;
  idempotencyPurgeLastRunAt = Date.now();
  try {
    await idempotencyPurgeTick();
  } finally {
    idempotencyPurgeRunning = false;
  }
}

/** Démarre les tâches de fond. Idempotent: un second appel est sans effet. */
export function startBackgroundJobs(): void {
  if (schedulerStarted) {
    return;
  }
  schedulerStarted = true;

  setTimeout(() => {
    void runAlertCycle("démarrage");
    void runBackupTick("démarrage");
    void runIdempotencyPurgeTick();
  }, INITIAL_DELAY_MS);

  setInterval(() => {
    void runAlertCycle("périodique");
    void runBackupTick("périodique");
    void runIdempotencyPurgeTick();
  }, ALERT_CHECK_INTERVAL_MS);

  log.info({ intervalSeconds: ALERT_CHECK_INTERVAL_MS / 1000 }, "cycle d'alertes et sauvegarde planifiés");
}
