import { isReadOnlyRole as isReadOnlyRoleName } from "@shared/constants/roles";

/**
 * Profil en lecture seule (lecteur) : les écrans partagés masquent leurs boutons d'écriture
 * (exports, « Ajouter un OT »...) au lieu d'afficher un bouton qui finit en 403.
 */
export function isReadOnlyRole(user: { role?: string | null } | null | undefined): boolean {
  return isReadOnlyRoleName(user?.role);
}
