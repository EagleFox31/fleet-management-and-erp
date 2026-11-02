/**
 * Période `from` / `to` des indicateurs et des rapports (CDC #7).
 *
 * `isoDateSchema` accepte toute chaîne `AAAA-MM-JJ`, y compris `9999-12-30` ou `2026-02-31` : une
 * période démesurée faisait boucler le calcul des mois pendant des secondes avant une 500. Ici :
 * date réelle du calendrier, année entre 2000 et 2100, écart de 36 mois civils au plus.
 */
import { z } from "zod";
import { isoDateSchema } from "./common";

export const KPI_MIN_YEAR = 2000;
export const KPI_MAX_YEAR = 2100;
/** Nombre maximal de mois civils touchés par une période (premier et dernier mois compris). */
export const KPI_MAX_SPAN_MONTHS = 36;

/** `true` si `AAAA-MM-JJ` désigne un jour qui existe (le 31 février et le mois 13 sont refusés). */
export function isRealCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Nombre de mois civils touchés par [from, to], bornes incluses (comparaison numérique). */
export function spanInMonths(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return ty * 12 + tm - (fy * 12 + fm) + 1;
}

export const kpiDateSchema = isoDateSchema
  .refine(isRealCalendarDate, "Date inexistante dans le calendrier.")
  .refine((v) => Number(v.slice(0, 4)) >= KPI_MIN_YEAR && Number(v.slice(0, 4)) <= KPI_MAX_YEAR, {
    message: `L'année doit être comprise entre ${KPI_MIN_YEAR} et ${KPI_MAX_YEAR}.`,
  });

/**
 * Message d'erreur de la période, ou `null` si elle est acceptable.
 *
 * `from` seul : le serveur complète `to` par aujourd'hui (`kpi-rules.ts`), donc `from=2001-01-01`
 * couvre plus de 300 mois. On contrôle la période réelle avec `today` (UTC par défaut : un jour
 * d'écart ne change rien à un plafond en mois). `to` seul reste couvert, le serveur en déduit
 * `from` sur 12 mois ; sans borne, défaut serveur de 12 mois.
 */
export function kpiPeriodIssue(
  q: { from?: string; to?: string },
  today: string = new Date().toISOString().slice(0, 10),
): { message: string; path: "from" | "to" } | null {
  if (!q.from) return null;
  const to = q.to ?? today;
  if (q.from > to) return { message: "La date de début doit précéder la date de fin.", path: "from" };
  if (spanInMonths(q.from, to) > KPI_MAX_SPAN_MONTHS) {
    return { message: `La période ne peut pas dépasser ${KPI_MAX_SPAN_MONTHS} mois.`, path: q.to ? "to" : "from" };
  }
  return null;
}

/** À poser en `superRefine` d'un objet qui porte `from` et `to`. */
export function refineKpiPeriod(q: { from?: string; to?: string }, ctx: z.RefinementCtx): void {
  const issue = kpiPeriodIssue(q);
  if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.message, path: [issue.path] });
}

/** Période seule, utilisable telle quelle comme `kpiQuerySchema`. */
export const kpiPeriodQuerySchema = z
  .object({ from: kpiDateSchema.optional(), to: kpiDateSchema.optional() })
  .superRefine(refineKpiPeriod);
