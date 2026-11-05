# Droits : écarts 4 et 9 de la matrice des rôles (#457)

## Quoi
- **Écart 4** : un technicien pouvait annuler une demande de pièce en attente. Le droit
  existait dans la table serveur `STATUS_PERMISSIONS` (`pending.cancelled`), mais aucun écran
  ne l'utilisait. Il est retiré : seuls `admin` et `workshop_manager` annulent.
- **Écart 9** : plusieurs écrans étaient en `PrivateRoute`, donc ouverts à tout utilisateur
  connecté, alors que leur API filtre par rôle. Ils passent en `RoleRoute` avec les rôles de l'API :
  `/operations`, `/fuel`, `/maintenance/preventive`, `/technicians`, `/missions`, `/inventory/tires`.
- La liste des rôles gestionnaires de stock vit maintenant dans `shared/constants/roles.ts`
  (`INVENTORY_MANAGER_ROLES`), et `isInventoryManager` (`server/middleware/auth.ts`) l'utilise.
- Inclus aussi : deux points mineurs de relecture de #452 (rotation de pneus).

## Comment
- `tests/unit/server/part-requirement-cancel-roles.test.ts` vérifie qui peut annuler.
- `tests/unit/client/screen-route-roles.test.ts` vérifie que chaque écran protégé accepte les
  rôles de son API. Il vérifie aussi que le menu d'un rôle ne mène à aucun écran fermé pour ce rôle.
- Deux tests de `part-requirements-workflow.test.ts` vérifiaient l'ancien droit du technicien.
  Ils vérifient maintenant le refus (décision validée par l'orchestrateur).
- Le nouveau test a trouvé un écart : le menu de la secrétaire menait à `/inventory/tires`.
  `secretary` est donc ajouté aux rôles de cette route.

## Pourquoi
Un droit déclaré côté serveur mais absent de l'UI peut être appelé directement par l'API.
Un écran ouvert à tous alors que son API refuse affiche des 403 au lieu de masquer l'accès.
Ici, le droit serveur, l'écran et le menu dérivent tous des mêmes constantes partagées.

## Restes
- Défaut préexistant, non corrigé ici : sur `/operations`, le rôle direction (`management`)
  reçoit un 403 sur `/api/billing/statistics`. À traiter dans un lot dédié.
- e2e : vérification statique seulement. Tous les rôles utilisés par les specs restent autorisés.
