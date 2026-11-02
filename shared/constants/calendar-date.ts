/**
 * Date calendaire `AAAA-MM-JJ` réelle (refuse `2027-02-30`, `31/12/2027`, les heures).
 * À utiliser avant d'envoyer une date saisie à une colonne `date` : PostgreSQL
 * renverrait sinon une erreur levée en 500.
 */
export function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
