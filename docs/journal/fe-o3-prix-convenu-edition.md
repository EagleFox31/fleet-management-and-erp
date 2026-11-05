# O3 lot 3b : modifier le prix convenu d'une mission

## Quoi
`GET` et `PUT /api/missions/:id/agreed-price` (route dédiée, `updateMissionSchema` inchangé), table
`mission_price_history`, carte « Prix convenu » sur l'onglet détails de `missions/[id].tsx`.

## Comment
- Règles (décision du 5 novembre 2026) : avant le départ, gestionnaires de missions ; en cours ou livrée,
  admin et direction avec motif obligatoire ; clôturée ou annulée, bloqué ; facture non annulée liée, 409.
  `canEditMissionPrice` (shared) décide côté écran et côté serveur.
- Transaction avec `FOR UPDATE`, historique inséré dans la même transaction, rejeu identique = no-op.
- Le serveur fait foi : l'écran ignore l'existence d'une facture et affiche le 409 tel quel.
- Réutilise `TariffSuggestionPanel` dans un dialogue ; `useSingleFlightMutate` ; invalidation du détail, des
  listes de missions et des factures.

## Pourquoi
- Argent : double clic, courses et corrections silencieuses sont exclus par verrou, historique et motif.
- Lecture réservée aux lecteurs de la grille (voir `mission-price-scope`) : la trame temps réel n'a pas de prix. Sur `mission_updated`, le client invalide `missionPricePath(id)` et relit le prix avec ses droits (couche 3).

## Revue #498
- R1 : `generateInvoiceFromMission` verrouille la ligne mission (`FOR UPDATE OF missions`) comme le PUT : facture et correction de prix se suivent. Seul site d'insertion d'une facture liée à une mission. Constat : l'insertion de la facture prenait déjà un verrou de clé étrangère sur la ligne mission, qui attend le PUT ; le verrou explicite rend la règle lisible et ne dépend plus de la FK. Le contrat (attente du verrou, course PUT / génération) passe avec ou sans lui : il garde le comportement, pas la ligne.
- R2 : invalidation du prix sur `mission_updated`, testée.
- Tarif d'origine : traçabilité seule (existence vérifiée) ; le contrôle actif / trajet reste celui de la création (#487).

## Near miss : CI rouge sur #498 (FK users hors du ménage de test)
- Contexte : la table neuve `mission_price_history` porte `changed_by -> users` sans `ON DELETE`. Le garde-fou `cleanup-users-fk-coverage` a vu une 37e clé non traitée (36 attendues) : job integration rouge au run 42086421192.
- Cause racine : table créée avec une FK vers `users` sans passer par `tests/support/cleanup.ts`. Les tests locaux de contrat passaient (leurs comptes sont nettoyés à part), seul le test d'intégration de couverture voit le trou.
- Résolution : suppression par compte (`changedBy` dans les comptes de test) dans `deleteOrphanTestRows` et dans le ménage `ids.userIds`. La liste gelée `NOT_YET_HANDLED` ne change pas : elle ne fait que diminuer.
- Prévention : le garde-fou existant l'a attrapé ; règle ajoutée : toute table neuve avec FK vers `users` entre dans le ménage de test dans le même commit, et `npm run test:integration` se rejoue avant livraison.
- Leçon : `npm test` et les contrats ne suffisent pas pour une table neuve ; rejouer l'intégration.
- Second incident, local : le nettoyage des worktrees a supprimé `b7-pal10`, vers lequel pointait la junction `node_modules` de `b7-o1` (elle-même cible de `b7-o3`). Junctions repointées vers `b7-emo1`. Règle : jamais de junction en chaîne, une seule cible réelle.
