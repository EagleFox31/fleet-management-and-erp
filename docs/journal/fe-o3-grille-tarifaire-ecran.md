# O3 lot 2 : écran de la grille tarifaire

## Quoi
Écran `/operations/tariffs` (drapeau `pricing`) : liste filtrable (tarifs actifs), création, modification et désactivation.

## Comment
- Menu et garde de route : `TARIFF_GRID_READ_ROLES` (admin, direction, secrétariat, logistique).
- Boutons créer, modifier, désactiver et sélecteur de clients : visibles seulement si `canWriteTariffGrid` (`TARIFF_GRID_WRITE_ROLES` : admin, direction). Le test `lot-screen-api-roles` verrouille le lien écran / route / garde.
- Prix affiché et saisi en XAF entier ; erreurs serveur (409 chevauchement, 400) via `userMessageOf`.
- Mutations par `useSingleFlightMutate`, id passé par les variables, invalidation de la liste au succès.

## Pourquoi
Le tarif est une suggestion : l'écran ne modifie jamais une facture ni une mission.

## Dette connue
Sélecteurs natifs (à passer au Select du design system), pas de pagination, `clientName` vide dans les réponses de création et modification.
