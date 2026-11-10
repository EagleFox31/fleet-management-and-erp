import { WORK_ORDER_STATUS_LABELS } from "@shared/constants/work-orders";
import type { AuditAction, AuditLogRow } from "@shared/contracts/audit-logs";

const ACTION_LABELS: Record<AuditAction, string> = {
  create: "Création",
  update: "Modification",
  delete: "Suppression",
  lock: "Verrouillage",
  unlock: "Déverrouillage",
  login: "Connexion",
};

export interface WorkOrderHistoryEntry {
  id: number;
  at: string;
  who: string;
  action: string;
  /** Changement de statut lisible, seul détail affiché : le reste du corps de la requête reste dans le journal d'audit. */
  statusChange: string | null;
}

/** Mise en forme d'une écriture auditée pour la chronologie : aucun JSON brut, aucune clé technique. */
export function toWorkOrderHistoryEntry(row: AuditLogRow): WorkOrderHistoryEntry {
  const status = row.details?.status;
  const label =
    typeof status === "string" && Object.prototype.hasOwnProperty.call(WORK_ORDER_STATUS_LABELS, status)
      ? WORK_ORDER_STATUS_LABELS[status as keyof typeof WORK_ORDER_STATUS_LABELS]
      : null;
  return {
    id: row.id,
    at: row.at,
    who: row.userName ?? "Utilisateur inconnu",
    action: ACTION_LABELS[row.action],
    statusChange: label ? `Statut : ${label}` : null,
  };
}
