import { maintenanceDaysUntil } from "@shared/constants/maintenance-due-day";

export interface MaintenanceScheduleStatusInput {
  isActive: boolean;
  scheduledDate?: string | Date | null;
  frequency: string;
  frequencyValue: number;
}

/** Badge de statut d'un plan d'entretien, commun aux écrans d'entretien (jour UTC, #342). */
export function getMaintenanceScheduleStatus(schedule: MaintenanceScheduleStatusInput, now: Date = new Date()) {
  if (!schedule.isActive) {
    return { label: "Inactive", color: "bg-slate-400 hover:bg-slate-500" };
  }

  const daysUntil = maintenanceDaysUntil(schedule, now);
  if (daysUntil !== null) {
    if (daysUntil < 0) return { label: "En retard", color: "bg-red-500 hover:bg-red-600" };
    if (daysUntil < 15) return { label: "À venir", color: "bg-amber-500 hover:bg-amber-600" };
    return { label: "Planifiée", color: "bg-green-500 hover:bg-green-600" };
  }

  // Plan au kilométrage : le kilométrage courant n'est pas disponible sur ces écrans.
  return { label: "À vérifier", color: "bg-blue-500 hover:bg-blue-600" };
}
