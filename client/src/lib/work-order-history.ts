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

/**
 * Libellé de l'action d'après le chemin (le verbe HTTP seul est faux : un POST sur /parts ajoute une pièce,
 * un POST sur /awaiting-parts change le statut). Repli sur le verbe pour un chemin inconnu.
 */
const PATH_ACTIONS: Array<[RegExp, string]> = [
  [/\/awaiting-parts$/, "Statut : Attente pièces"],
  [/\/quality-check$/, "Contrôle qualité"],
  [/\/part-requirements\/\d+\/issue$/, "Sortie de pièce du stock"],
  [/\/parts$/, "Ajout de pièce"],
  [/\/items$/, "Ajout de ligne"],
  [/\/technician\/work-orders\/\d+\/status$/i,"Changement de statut (technicien)"],
];

function actionLabel(row: AuditLogRow): string {
  const path = (row.path ?? "").split("?")[0].replace(/\/+$/, "");
  const hit = PATH_ACTIONS.find(([re]) => re.test(path));
  if (hit && row.method !== "DELETE") return hit[1];
  return ACTION_LABELS[row.action];
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
    action: actionLabel(row),
    statusChange: label ? `Statut : ${label}` : null,
  };
}
