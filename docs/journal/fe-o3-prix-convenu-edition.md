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
- Lecture réservée aux lecteurs de la grille (voir `mission-price-scope`) : la trame temps réel n'a pas de prix.
