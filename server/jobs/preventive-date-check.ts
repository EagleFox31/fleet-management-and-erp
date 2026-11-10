/**
 * Préventif par date, en tâche de fond (lot V5a).
 *
 * `checkDateBasedMaintenance` ne tournait que par la route manuelle `/api/check-all-maintenance`.
 * L'ordonnanceur le rejoue dans le cycle d'alertes, mais au plus une fois par `MIN_INTERVAL_MS` :
 * le contrôle parcourt tous les véhicules et leurs plans, inutile toutes les 5 minutes.
 *
 * Idempotence : portée par le service (un OT ouvert, ou clos pour la même échéance, bloque un
 * doublon), donc un redémarrage ou un second passage le même jour ne crée rien de plus.
 */
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("preventive-date-check");

/** Intervalle minimal entre deux passages : un passage en échec est repris dans la journée. */
export const PREVENTIVE_DATE_CHECK_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Vrai si un passage est dû : jamais lancé, ou le dernier remonte à `minIntervalMs` ou plus. */
export function isPreventiveDateCheckDue(
  lastRunAt: number | null,
  now: number,
  minIntervalMs: number = PREVENTIVE_DATE_CHECK_MIN_INTERVAL_MS,
): boolean {
  return lastRunAt === null || now - lastRunAt >= minIntervalMs;
}

export type PreventiveDateCheckDeps = {
  check: () => Promise<ReadonlyArray<{ id: number }>>;
};

/** Un passage. Ne lève jamais : l'échec est journalisé et le cycle d'alertes continue. */
export async function runPreventiveDateCheck(deps: PreventiveDateCheckDeps): Promise<number> {
  try {
    const created = await deps.check();
    if (created.length > 0) {
      log.info({ created: created.length, workOrderIds: created.map((wo) => wo.id) }, "OT préventifs par date créés");
    }
    return created.length;
  } catch (err) {
    log.error({ err }, "préventif par date en échec");
    return 0;
  }
}

let lastRunAt: number | null = null;
let running = false;

/** Point d'entrée de l'ordonnanceur : garde de fréquence et anti-chevauchement. */
export async function preventiveDateCheckTick(now: number = Date.now()): Promise<void> {
  if (running || !isPreventiveDateCheckDue(lastRunAt, now)) return;
  running = true;
  lastRunAt = now;
  try {
    const { preventiveMaintenanceService } = await import("../services/preventive-maintenance-service");
    await runPreventiveDateCheck({ check: () => preventiveMaintenanceService.checkDateBasedMaintenance() });
  } finally {
    running = false;
  }
}

/** Remise à zéro pour les tests. */
export function resetPreventiveDateCheckState(): void {
  lastRunAt = null;
  running = false;
}
