/**
 * Interrupteur du préventif par date et des alertes de papiers chauffeur en tâche de fond (V5a).
 * `PREVENTIVE_DATE_JOB_ENABLED` : actif par défaut ; `false` ou `0` (casse et espaces ignorés) le coupe.
 * Toute autre valeur, y compris inconnue, laisse le job actif : aucun changement de comportement sans réglage.
 * La route manuelle `/api/check-all-maintenance` n'est pas concernée.
 */
export function isPreventiveDateJobEnabled(raw: string | undefined = process.env.PREVENTIVE_DATE_JOB_ENABLED): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  return value !== "false" && value !== "0";
}
