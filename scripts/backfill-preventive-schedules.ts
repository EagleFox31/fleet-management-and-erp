/**
 * Rattrapage P3-1 : plans préventifs calendaires restés bloqués derrière un OT déjà clos
 * (clôtures antérieures à P3-1). Lecture seule par défaut.
 * L'écriture exige `--apply --yes` : le script lit `.env`, donc la base réelle.
 * La règle et l'UPDATE conditionnel sont ceux de la clôture : un second apply n'écrit rien.
 * Un plan très en retard n'avance que d'une période ; le balayage génère aussitôt l'OT suivant.
 *
 *   npm run backfill:preventive-schedules                  # aperçu
 *   npm run backfill:preventive-schedules -- --apply --yes # écriture
 */
import { pool } from "../server/db";
import { moduleLogger } from "../server/lib/logger";
import { preventiveMaintenanceService, type ScheduleCatchUp } from "../server/services/preventive-maintenance-service";

const log = moduleLogger("backfill-preventive-schedules");
const apply = process.argv.includes("--apply");
const confirmed = process.argv.includes("--yes");

/** Hôte et base visés, hôte masqué : assez pour reconnaître la cible, pas pour la divulguer. */
function describeTarget(url: string | undefined): string {
  if (!url) return "(DATABASE_URL absente)";
  try {
    const u = new URL(url);
    const [first, ...rest] = u.hostname.split(".");
    const masked = first.length > 4 ? `${first.slice(0, 4)}***` : "***";
    return `${[masked, ...rest].join(".")}${u.pathname}`;
  } catch {
    return "(DATABASE_URL illisible)";
  }
}

function printTable(rows: ScheduleCatchUp[], heading: string): void {
  const lines = [
    heading,
    ...rows.map((r) => `  ${r.registrationNumber.padEnd(12)} ${r.title.slice(0, 40).padEnd(40)} ${r.currentDate} -> ${r.targetDate}  (plan ${r.scheduleId}, OT ${r.workOrderId})`),
    `  ${rows.length} plan(s)`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function main() {
  const target = describeTarget(process.env.DATABASE_URL);
  process.stdout.write(`Base visée : ${target}\n`);
  if (apply && !confirmed) {
    log.warn({ target }, "Écriture refusée : relancer avec --apply --yes après lecture de l'aperçu");
    process.exitCode = 1;
    return;
  }
  const rows = apply
    ? await preventiveMaintenanceService.applyScheduleCatchUp()
    : await preventiveMaintenanceService.planScheduleCatchUp();
  for (const r of rows) {
    log.info(r, apply ? "Plan avancé" : "Plan à avancer");
  }
  printTable(rows, apply ? "Plans avancés :" : "Plans à avancer (aperçu, rien n'est écrit) :");
  log.info(
    { mode: apply ? "apply" : "plan", target, count: rows.length },
    apply ? "Rattrapage appliqué" : "Aperçu terminé, relancer avec --apply --yes pour écrire",
  );
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    log.error({ err }, "Rattrapage P3-1 en échec");
    await pool.end();
    process.exitCode = 1;
  });
