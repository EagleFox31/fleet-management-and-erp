/** Contrat des écritures sur la boîte d'alertes (ALR2). */
export const ALERTS_PATH = "/api/alerts";
export const ALERT_READ_ALL_PATH = `${ALERTS_PATH}/read-all`;

export function alertPath(id: number | string): string {
  return `${ALERTS_PATH}/${id}`;
}

export type MarkAllAlertsReadResponse = { updated: number };
