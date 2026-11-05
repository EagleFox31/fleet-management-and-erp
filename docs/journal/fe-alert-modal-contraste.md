# Contraste des boutons de confirmation d'AlertModal

## Quoi
Les boutons de confirmation des variantes avertissement, succes et danger d'`alert-modal.tsx` passent en fond plein conforme AA, avec un survol qui assombrit.

## Comment
- avertissement : `bg-warning-text` (blanc dessus 8,24:1, contre 2,14:1 avec `bg-warning`) ;
- succes et danger : `bg-success` / `bg-destructive`, survol `hover:brightness-90` (le survol `/90` eclaircissait le bouton) ;
- garde-fou `tests/unit/client/alert-modal-confirm-contrast.test.ts` : blanc sur chaque fond `bg-<jeton>` >= 4,5 en theme clair, et aucun `hover:bg-<jeton>/NN`. Rouge si l'on remet `bg-warning` ou `hover:bg-success/90`.

## Pourquoi
Remarque d'accessibilite de la relecture de #436 : texte blanc sur ambre illisible, survol qui reduit le contraste.
