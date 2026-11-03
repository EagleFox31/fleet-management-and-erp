/**
 * Portées temps réel des événements d'ordre de travail (AGENTS.md §11).
 *
 * Un OT n'est lu que par le personnel : aucun écran client n'écoute ces événements, un client n'en
 * reçoit donc aucun (moindre privilège). Une trame qui porte l'objet métier (montants, pièces)
 * part aux seuls rôles qui lisent les coûts d'OT ; une trame d'identifiants part à tout le
 * personnel. Fonctions plutôt que constantes : chaque émission reçoit sa propre liste.
 */
import { STAFF_ROLES, WORK_ORDER_COST_READ_ROLES } from "@shared/constants/roles";

/** Trame sans montant : identifiants, statut. */
export const workOrderStaffScope = () => ({ type: "roles" as const, roles: [...STAFF_ROLES] });

/** Trame qui porte l'OT, une demande ou une pièce (montants possibles) : hors chauffeur. */
export const workOrderCostScope = () => ({ type: "roles" as const, roles: [...WORK_ORDER_COST_READ_ROLES] });
