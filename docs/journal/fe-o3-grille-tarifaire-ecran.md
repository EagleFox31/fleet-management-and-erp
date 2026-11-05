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

## Réserves de relecture (levées)
- Garde écran / route : POST, PUT et DELETE déclarés.
- Désactivation : confirmation préalable, échec nommé « Désactivation impossible ».
- Réactivation depuis l'édition d'un tarif désactivé ; le 409 de chevauchement s'affiche tel quel.
- Checkbox et Select du design system ; client absent de /api/clients : « Client #id (inactif) ».

## Écart assumé à la règle des 3 couches
Aucun événement WebSocket : donnée de référence modifiée par deux rôles seulement (admin, direction). Instantané local et invalidation de la liste sont faits ; pas de temps réel inter-profils.

## Dette connue
Pas de pagination ; `clientName` vide dans les réponses de création et modification.
