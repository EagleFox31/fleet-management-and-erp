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
- **Quoi** : (1) si le déverrouillage échoue, la connexion est détruite (`client.release(err)`) au lieu d'être rendue au pool avec le verrou ; (2) sur `close`, le verrou n'est lâché que si la réponse est terminée, sinon on attend `finish`, avec un minuteur de secours de 5 s (inférieur au statement_timeout de 10 s : constaté, avec 15 s une coupure faisait passer les demandeurs suivants en 409) ; (3) `statement_timeout` (57014) à la prise du verrou : `AppError(409, « Opération en cours sur les administrateurs, réessayez. »)`.
- **Tests** : `tests/unit/server/last-admin-lock.test.ts` (client pg factice, une par correction) ; contrat : coupure de la connexion du détenteur en cours de traitement, il reste un admin actif et une requête suivante aboutit.
- **Suivi (hors PR)** : épuisement du pool, un détenteur de verrou occupe une connexion pendant l'attente des autres. Piste : `pg_try_advisory_lock` en courte boucle en rendant la connexion entre deux essais.

## 2026-11-05 — Lot de relecture : fuite du verrou sur déconnexion, preuve rouge déterministe
- **Quoi** : état de la réponse contrôlé juste après la prise du verrou (terminée : libération aussitôt ; détruite : minuteur de secours), libération sur `finish`, connexion détruite (`release(true)`) si le déverrouillage échoue, 57014 en 409 lisible. Import remis avant `const log`. Restauration des admins préexistants en `finally` dans le test (réparation manuelle documentée si le processus meurt). Motif ajouté à `docs/analysis/LESSONS_LEARNED.md`.
- **Rouge / vert déterministe** (base locale `fleet_test_lastadmin`) :
  - Rouge A (garde non montée) : le contrat « la garde attend le verrou » échoue à coup sûr, le test tenant lui-même le verrou consultatif ; la requête est servie sans attendre. 5 échecs sur 15 au total.
  - Rouge B (contrôle d'état après la prise du verrou retiré) : « déconnexion du client pendant l'attente du verrou » échoue (verrou jamais rendu).
  - Vert : 27/27 sur les 3 fichiers de contrat concernés ; unitaires 2453 passés, 2 ignorés ; tsc 0 erreur.
  - Les courses sur le rôle et sur la suppression restent en non-régression, mais ne sont pas fiables au rouge (3 à 4 échecs sur 7 passes selon le tirage).
- **Suivi (hors PR)** : épuisement du pool, un détenteur ou un attendant occupe une connexion. Piste : `pg_try_advisory_lock` en boucle courte, connexion rendue entre deux essais.
