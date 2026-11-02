import { AppError } from "./app-error";
import { isIsoCalendarDate } from "@shared/constants/calendar-date";

const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function parseBound(raw: unknown, fallback: () => Date, label: string): Date {
  if (raw === undefined || raw === "") return fallback();
  if (typeof raw !== "string") throw new AppError(400, `${label} invalide.`);
  // `new Date("2033-02-30")` donne le 2 mars : une date AAAA-MM-JJ doit exister au calendrier.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && !isIsoCalendarDate(raw)) throw new AppError(400, `${label} invalide.`);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new AppError(400, `${label} invalide.`);
  return date;
}

/**
 * Période d'un rapport (`startDate`, `endDate`) : 30 derniers jours par défaut.
 * Une valeur qui n'est pas une date est refusée en 400 (un `Invalid Date` serait sinon
 * comparé ou transmis à SQL, pour un résultat vide ou une erreur de base).
 */
export function parseReportPeriod(query: { startDate?: unknown; endDate?: unknown }): { startDate: Date; endDate: Date } {
  return {
    startDate: parseBound(query.startDate, () => new Date(Date.now() - DEFAULT_WINDOW_MS), "Date de début"),
    endDate: parseBound(query.endDate, () => new Date(), "Date de fin"),
  };
}
