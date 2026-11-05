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

## 2026-11-05 — Corrections de relecture sécurité sur le verrou
- **Quoi** : (1) si le déverrouillage échoue, la connexion est détruite (`client.release(err)`) au lieu d'être rendue au pool avec le verrou ; (2) le verrou est lâché à l'appel de `res.end` (enveloppé, après l'écriture aval, même socket détruite) ou sur `finish` ; `close` sur socket détruite ne libère pas avant `res.end`. Le minuteur n'est plus qu'un filet long de 30 s (`LOCK_FALLBACK_MS`), au-delà du pire temps de l'aval. Justification : l'ancien minuteur de 5 s libérait même si l'écriture aval n'était pas terminée (pool saturé), rouvrant la course entre deux admins ; on accepte de perdre en disponibilité (demandeurs en attente en 409 après 10 s), jamais en intégrité. Chaque requête gardée tient 2 connexions (celle du verrou et celle de l'écriture), ce qui aggrave l'épuisement du pool ; (3) `statement_timeout` (57014) à la prise du verrou : `AppError(409, « Opération en cours sur les administrateurs, réessayez. »)`.
- **Tests** : `tests/unit/server/last-admin-lock.test.ts` (client pg factice, une par correction) ; contrat : coupure de la connexion du détenteur en cours de traitement, il reste un admin actif et une requête suivante aboutit.
- **Suivi (hors PR)** : épuisement du pool, un détenteur de verrou occupe une connexion pendant l'attente des autres. Piste : `pg_try_advisory_lock` en courte boucle en rendant la connexion entre deux essais.

## 2026-11-05 — Lot de relecture : fuite du verrou sur déconnexion, preuve rouge déterministe
- **Quoi** : état de la réponse contrôlé juste après la prise du verrou (terminée : libération aussitôt ; détruite : minuteur de secours), libération sur `finish`, connexion détruite (`release(true)`) si le déverrouillage échoue, 57014 en 409 lisible. Import remis avant `const log`. Restauration des admins préexistants en `finally` dans le test (réparation manuelle documentée si le processus meurt). Motif ajouté à `docs/analysis/LESSONS_LEARNED.md`.
- **Rouge / vert déterministe** (base locale `fleet_test_lastadmin`) :
  - Rouge A (garde non montée) : le contrat « la garde attend le verrou » échoue à coup sûr, le test tenant lui-même le verrou consultatif ; la requête est servie sans attendre. 5 échecs sur 15 au total.
  - Rouge B (contrôle d'état après la prise du verrou retiré) : plus une preuve. Rejoué sur 5c4b317a : unitaires 10/10 et contrat 15/15 restent verts, la fuite étant désormais fermée par l'enveloppe de `res.end`.
  - Rouge C (l'enveloppe de `res.end` n'appelle plus `release`) : unitaire (4) « socket détruite : libération dès res.end » et 2 contrats LAG3 (« déconnexion pendant l'attente du verrou », « le détenteur coupe en cours de traitement ») échouent ; vert une fois l'appel rétabli.
  - Vert : 27/27 sur les 3 fichiers de contrat concernés ; unitaires 2453 passés, 2 ignorés ; tsc 0 erreur.
  - Les courses sur le rôle et sur la suppression restent en non-régression, mais ne sont pas fiables au rouge (3 à 4 échecs sur 7 passes selon le tirage).
- **Suivi (hors PR)** : épuisement du pool, un détenteur ou un attendant occupe une connexion. Piste : `pg_try_advisory_lock` en boucle courte, connexion rendue entre deux essais.
- **Contrat LAG3 (réserves)** : les admins préexistants sont rétablis d'abord, la connexion du détenteur est détruite sans requête préalable (le verrou de session tombe à la fermeture), le verrou est rendu après chaque test même sur échec, `takeLock` détruit un détenteur oublié. Les cas LAG3 sont ignorés si le trigger de base `trg_users_keep_active_admin` est posé (couverts par le test d'intégration du trigger).

## Traduction des refus du trigger sur les 4 routes d'écriture
- **Quoi** : le refus du trigger « au moins un administrateur actif » et les conflits 40P01 / 40001 répondent par un 400 ou un 409 lisible sur PATCH `/api/users/:id`, DELETE `/api/users/:id`, DELETE `/api/admin/users/:id` et PATCH `/api/admin/users/:id/toggle`. Avant : 404 ou 500.
- **Comment** : `storage.updateUser` et `deleteUser` relancent ces seules erreurs (`isAdminGuardDbRefusal`), les routes les passent à `next()`, le gestionnaire central traduit avec `LAST_ADMIN_MESSAGE`, constante unique partagée avec la garde applicative. Un contrat par route retire l'appelant des admins actifs juste avant l'écriture pour atteindre le refus de base. Rouge : traduction neutralisée, 404, 404, 404 et 500 ; vert une fois rétablie.
- **Pourquoi** : une base qui refuse l'opération est un cas attendu, pas une panne ; l'utilisateur doit lire la raison et non une erreur technique. Deux désactivations croisées sans garde n'obtiennent aucun succès : c'est une question de disponibilité, traitée par le 409 à réessayer.
