import { daysBetweenDateOnly, toExpiryDateOnly, todayUtcDateOnly } from "@shared/constants/expiry-day";

export type MaintenancePriority = 'low' | 'medium' | 'high';

/**
 * Priorité selon la proximité de l'échéance, en jours calendaires UTC (#342) :
 * jusqu'à 7 jours (retard compris) haute, jusqu'à 14 moyenne, sinon basse.
 * Échéance absente ou illisible : jour courant, donc haute, comme avant.
 */
export function maintenancePriorityOf(dueDate: string | Date | null | undefined, now: Date = new Date()): MaintenancePriority {
  const today = todayUtcDateOnly(now);
  const diffDays = daysBetweenDateOnly(toExpiryDateOnly(dueDate) ?? today, today);
  if (diffDays <= 7) return 'high';
  if (diffDays <= 14) return 'medium';
  return 'low';
}
