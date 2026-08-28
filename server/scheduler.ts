import { alertService } from "./services/alert-service";

/**
 * Ordonnanceur des tâches de fond.
 *
 * Volontairement minimal: `setInterval` en mémoire du processus. Suffisant tant
 * que l'application tourne en instance unique et que la seule tâche est le cycle
 * d'alertes.
 *
 * Limites assumées:
 * - en multi-instance, chaque instance exécuterait le cycle (doublons);
 * - un cycle prévu pendant un arrêt du processus est simplement sauté.
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

let schedulerStarted = false;
let alertCycleRunning = false;
let alertCycleSkipped = 0;

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
    console.warn(
      `[SCHEDULER] Cycle d'alertes ignoré (${reason}): le précédent tourne encore ` +
        `(${alertCycleSkipped} ignoré(s) au total).`,
    );
    return;
  }

  alertCycleRunning = true;
  const startedAt = Date.now();

  try {
    await alertService.runAllAlertChecks();
  } catch (error) {
    console.error(`[SCHEDULER] Cycle d'alertes en échec (${reason}):`, error);
  } finally {
    const durationMs = Date.now() - startedAt;
    alertCycleRunning = false;

    if (durationMs >= SLOW_CYCLE_THRESHOLD_MS) {
      console.warn(
        `[SCHEDULER] Cycle d'alertes lent: ${durationMs} ms ` +
          `(intervalle ${ALERT_CHECK_INTERVAL_MS} ms). Surveiller les requêtes N+1.`,
      );
    } else {
      console.log(`[SCHEDULER] Cycle d'alertes terminé en ${durationMs} ms (${reason})`);
    }
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
  }, INITIAL_DELAY_MS);

  setInterval(() => {
    void runAlertCycle("périodique");
  }, ALERT_CHECK_INTERVAL_MS);

  console.log(
    `[SCHEDULER] Cycle d'alertes planifié toutes les ${ALERT_CHECK_INTERVAL_MS / 1000} s`,
  );
}
