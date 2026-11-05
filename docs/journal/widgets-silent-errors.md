# Widgets : plus d'erreur muette ni de faux zéro

## Quoi
Quatre appels API en erreur derrière des écrans qui s'affichaient quand même.

| # | Écran | Appel | Cause | Choix |
|---|---|---|---|---|
| 1 | /operations | `GET /api/operations/stats/summary` (404) | endpoint inexistant ; la requête ne servait qu'au squelette de chargement, les KPI viennent de `stats/by-client` | requête et méthode `getStatsSummary` retirées ; squelette sur `statsByClient` ; en cas d'erreur, message « Indicateurs momentanément indisponibles » au lieu de KPI à 0 |
| 2 | /dashboard SEC | `GET /api/fuel-card/consumption-history` (404) | endpoint inexistant | rebranché sur `GET /api/fuel-records/consumption-history?period=year` (existant, `isAnyUser`), forme `{ date, quantity, cost, count }` adaptée ; état d'erreur explicite |
| 3 | /dashboard DIR | `GET /api/billing/statistics` (403) | serveur : admin, secrétaire, logistique | `canReadClientBilling(role)` (dérivé de `CLIENT_BILLING_EVENT_ROLES`) : `enabled` + widget masqué pour les autres rôles |
| 4 | /reports SEC | `GET /api/documentation` (403) | serveur : `isAdmin` seul, le client admettait aussi la secrétaire | `canReadDocumentation(role)` (admin) : requête, onglet Documentation et tuile « Guides & procédures » (qui affichait 0) réservés à l'admin |

## Comment
- `shared/constants/roles.ts` : `canReadClientBilling`, `DOCUMENTATION_READ_ROLES`, `canReadDocumentation`.
- Gardes gelées mises à jour : clé morte `/api/fuel-card/consumption-history` retirée de `realtime-satellites.ts` et de la liste gelée de `query-keys-routes.test.ts` ; compte palette de `reports/index.tsx` 53 -> 51 (tuile supprimée).
- Test : `tests/unit/client/widgets-role-gated-queries.test.ts` (aucun pattern de rendu de composant dans le dépôt : helpers de rôle contre la liste serveur, plus garde source sur `enabled`).

## Pourquoi
Règle produit : jamais de faux zéro ni de widget en erreur muette.

## Tester
`node node_modules/vitest/vitest.mjs run tests/unit/client/widgets-role-gated-queries.test.ts`, puis se connecter en DIR (dashboard sans graphique CA) et en SEC (/reports sans onglet Documentation).

## Suite : statistiques de facturation ouvertes à la direction, relecture #463 (2026-11-05)

### Quoi
- Décision utilisatrice : la direction (`management`) voit les statistiques de facturation client. `GET /api/billing/statistics` passe de admin/secrétaire/logistique à + management.
- `CLIENT_BILLING_EVENT_ROLES` sert aussi aux autres routes de `billing.routes.ts` et au ciblage WebSocket (`billing.routes.ts`, `scheduler.ts`) : liste dédiée `CLIENT_BILLING_STATS_ROLES` (events + management), `canReadClientBilling` s'y fonde. Les autres routes de facturation et les événements restent inchangés (la direction ne reçoit donc pas les événements de facture en direct ; elle voit les chiffres au prochain rechargement).
- `enabled: canReadClientBilling(role)` sur `invoicing-dashboard.tsx` et `useClientBilling.ts`.
- Relecture : branche `isError` du graphique CA (message d'indisponibilité), `activeMissions` en erreur sans « 0 en cours » ni statut coloré, invalidations mortes de `/api/operations/stats/summary` retirées (`clients-panel.tsx`, `useRealTimeSync.ts`), axe du graphique carburant en `{ month: 'short', year: '2-digit' }`.

### Pourquoi
Aucun faux zéro ni erreur muette ; le rôle de la garde client suit la route serveur.

### Tester
`tests/contract/billing-statistics-roles.contract.test.ts` (management et secrétaire 200 ; client et technicien 403 ; management 403 sur `/api/billing/invoices`), `tests/unit/client/widgets-role-gated-queries.test.ts`.
