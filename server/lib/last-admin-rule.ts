export const LAST_ADMIN_MESSAGE = "Il doit toujours rester au moins un administrateur actif.";
export const SELF_ADMIN_ROLE_MESSAGE = "Vous ne pouvez pas retirer vous-même votre rôle d'administrateur.";

/**
 * Décision pure : le compte `targetId` cesse-t-il d'être administrateur actif (rôle changé,
 * désactivation ou suppression) sans qu'il reste un autre administrateur actif ?
 * `activeAdminIds` = ids des comptes `role = 'admin'` non supprimés, cible comprise.
 */
export function wouldLeaveNoActiveAdmin(activeAdminIds: readonly number[], targetId: number): boolean {
  if (!activeAdminIds.includes(targetId)) return false;
  return activeAdminIds.every((id) => id === targetId);
}
