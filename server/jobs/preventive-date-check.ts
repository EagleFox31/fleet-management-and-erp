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
import { isPreventiveDateJobEnabled } from "../lib/preventive-date-job-config";

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

export const PREVENTIVE_DATE_CHECK_LOCK_KEY = "fleetos:preventive-date-check";

export type PreventiveDateCheckDeps = {
  check: () => Promise<ReadonlyArray<{ id: number }>>;
  /** Verrou inter-instances : sans lui, pas de garde. `tryLock` renvoie vrai si obtenu. */
  lock?: { tryLock: () => Promise<boolean>; unlock: () => Promise<void> };
};

/** Un passage. Ne lève jamais : l'échec est journalisé et le cycle d'alertes continue. */
export async function runPreventiveDateCheck(deps: PreventiveDateCheckDeps): Promise<number> {
  let locked = false;
  try {
    if (deps.lock) {
      if (!(await deps.lock.tryLock())) {
        log.info("préventif par date déjà en cours sur une autre instance, passage ignoré");
        return 0;
      }
      locked = true;
    }
    const created = await deps.check();
    if (created.length > 0) {
      log.info({ created: created.length, workOrderIds: created.map((wo) => wo.id) }, "OT préventifs par date créés");
    }
    return created.length;
  } catch (err) {
    log.error({ err }, "préventif par date en échec");
    return 0;
  } finally {
    if (locked) {
      try {
        await deps.lock!.unlock();
      } catch (err) {
        log.error({ err }, "libération du verrou du préventif par date en échec");
      }
    }
  }
}

/** Verrou consultatif Postgres sur une connexion dédiée de la chaîne directe (voir idempotency-purge). */
async function createProductionLock(): Promise<NonNullable<PreventiveDateCheckDeps["lock"]>> {
  const { listenerPool } = await import("../db");
  type Client = { query: (q: string, p: unknown[]) => Promise<{ rows: Array<{ ok?: boolean }> }>; release: (destroy?: boolean) => void };
  let client: Client | null = null;
  return {
    async tryLock() {
      const c = await (listenerPool as unknown as { connect: () => Promise<Client> }).connect();
      try {
        const res = await c.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [PREVENTIVE_DATE_CHECK_LOCK_KEY]);
        if (res.rows[0]?.ok === true) {
          client = c;
          return true;
        }
      } catch (err) {
        c.release();
        throw err;
      }
      c.release();
      return false;
    },
    async unlock() {
      if (!client) return;
      const c = client;
      client = null;
      let unlocked = false;
      try {
        await c.query("SELECT pg_advisory_unlock(hashtext($1))", [PREVENTIVE_DATE_CHECK_LOCK_KEY]);
        unlocked = true;
      } finally {
        // Déverrouillage en échec : la connexion détient peut-être encore le verrou, la rendre au
        // pool le garderait pris. On la détruit, ce qui libère le verrou côté Postgres.
        c.release(unlocked ? undefined : true);
      }
    },
  };
}

let lastRunAt: number | null = null;
let running = false;

/** Point d'entrée de l'ordonnanceur : garde de fréquence et anti-chevauchement. */
export async function preventiveDateCheckTick(now: number = Date.now()): Promise<void> {
  if (!isPreventiveDateJobEnabled()) return;
  if (running || !isPreventiveDateCheckDue(lastRunAt, now)) return;
  running = true;
  lastRunAt = now;
  try {
    const { preventiveMaintenanceService } = await import("../services/preventive-maintenance-service");
    await runPreventiveDateCheck({
      check: () => preventiveMaintenanceService.checkDateBasedMaintenance(),
      lock: await createProductionLock(),
    });
  } catch (err) {
    // Ne lève jamais : sinon runAlertCycle saute la suite du cycle (factures clients en retard).
    log.error({ err }, "préventif par date : passage en échec");
  } finally {
    running = false;
  }
}

/** Remise à zéro pour les tests. */
export function resetPreventiveDateCheckState(): void {
  lastRunAt = null;
  running = false;
}
