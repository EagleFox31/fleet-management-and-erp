import type { IncidentSeverity, IncidentStatus } from "@shared/contracts/incidents";

export const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  low: "Faible",
  medium: "Moyenne",
  high: "Élevée",
};

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  open: "Ouverte",
  in_progress: "En cours",
  resolved: "Résolue",
};
