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
