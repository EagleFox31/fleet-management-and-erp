## 2026-11-03 11:34 — DRV2 et P2 : réserves de relecture de #139

- **Quoi** : spec 13, le passage à « Payée » est prouvé par une seconde trame `client_invoice_payment_recorded` pour la même facture (compte exact 1 puis 2), plus seulement à l'écran ; les 403 du paiement (logistique, technicien, chauffeur) et les trois 400 (montant négatif, non numérique, mode inconnu) vérifient le contrat `ApiErrorBody` (code = `codeForStatus`, message non vide, aucun détail technique, même filtre que PRT1).
- **Pourquoi** : réserves a et b de b7 ; une assertion d'écran au-delà du `refetchInterval` est satisfaite par le polling (AGENTS.md §3), un statut seul ne prouve pas le contrat d'erreur (§10).
- **Preuves** : e2e 13 et 19 sur `fleet_test_cov` (serveur port 5177, msedge) : 18/19 au premier passage, DRV2-1 vert au rejeu isolé (2/2), instable, sans lien avec le delta ; tsc 0.

