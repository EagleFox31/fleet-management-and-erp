# Journal — garde du dernier administrateur actif

Modèle d'entrée et règles : `README.md`.

## 2026-11-05 — Garde du dernier administrateur actif
- **Statut** : fait (PR brouillon)
- **Quoi** : il doit toujours rester au moins un administrateur actif ; un administrateur ne retire pas lui-même son rôle. Routes couvertes : `PATCH /api/users/:id` (changement de rôle), `DELETE /api/users/:id`, `DELETE /api/admin/users/:id`. Refus en 400 avec un message lisible, sans détail technique.
- **Comment** : routeur `server/api/last-admin-guard.routes.ts`, monté avant `registerRoutes`, qui contrôle puis passe la main par `next()` (la logique d'écriture reste celle de `routes.ts`, gelé). Règle pure dans `server/lib/last-admin-rule.ts` ; lecture des admins actifs, verrou et `assertNotLastActiveAdmin(res, id)` dans `server/lib/last-admin.ts`. Le contrôle et l'écriture aval sont sérialisés par un verrou consultatif Postgres tenu sur une connexion dédiée jusqu'à la fin de la réponse. `server/lib/route-id.ts` : `parseRouteId`, repris à l'identique de `38e4e015` (branche `fix/strict-id-*`), absent de `main` à cette date.
- **Pourquoi** : le PATCH acceptait `role` sans garde ; deux administrateurs pouvaient aussi se retirer mutuellement en même temps.
- **Limites** : le verrou ne couvre que les routes qui passent par la garde ; une écriture SQL directe n'est pas sérialisée (garantie complète = trigger en base, tâche `fleet-db`). La garde de bascule d'activation (`admin-users-guard.routes.ts`, PR #375) n'est pas modifiée : elle doit appeler `assertNotLastActiveAdmin`.
- **Preuves (base Postgres locale dédiée `fleet_test_lastadmin`)** :
  - Rouge (garde non montée) : 4 échecs sur 12 — rôle propre modifié (200 au lieu de 400), id mal formé accepté (200), suppression croisée `/api/users` et `/api/admin/users` : `[204, 204]`, zéro admin actif.
  - Vert (garde montée) : 12/12 ; avec les contrats voisins (auto-désactivation, suppression douce, PIN, chauffeurs) 47/47.
  - `tsc --noEmit` : 0 erreur ; unitaires : 2445 passés, 2 ignorés.
