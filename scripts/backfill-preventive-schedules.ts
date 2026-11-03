/**
 * Rattrapage P3-1 : plans préventifs calendaires restés bloqués derrière un OT déjà clos
 * (clôtures antérieures à P3-1). Lecture seule par défaut ; `--apply` pour écrire.
 * La règle et l'UPDATE conditionnel sont ceux de la clôture : un second apply n'écrit rien.
 *
 *   npm run backfill:preventive-schedules            # aperçu
 *   npm run backfill:preventive-schedules -- --apply # écriture
 */
import { pool } from "../server/db";
import { moduleLogger } from "../server/lib/logger";
import { preventiveMaintenanceService } from "../server/services/preventive-maintenance-service";

const log = moduleLogger("backfill-preventive-schedules");
const apply = process.argv.includes("--apply");

async function main() {
  const rows = apply
    ? await preventiveMaintenanceService.applyScheduleCatchUp()
    : await preventiveMaintenanceService.planScheduleCatchUp();
  for (const r of rows) {
    log.info(r, apply ? "Plan avancé" : "Plan à avancer");
  }
  log.info({ mode: apply ? "apply" : "plan", count: rows.length }, apply ? "Rattrapage appliqué" : "Aperçu terminé, relancer avec --apply pour écrire");
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    log.error({ err }, "Rattrapage P3-1 en échec");
    await pool.end();
    process.exitCode = 1;
  });
