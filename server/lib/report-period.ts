import { AppError } from "./app-error";

const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function parseBound(raw: unknown, fallback: () => Date, label: string): Date {
  if (raw === undefined || raw === "") return fallback();
  if (typeof raw !== "string") throw new AppError(400, `${label} invalide.`);
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
