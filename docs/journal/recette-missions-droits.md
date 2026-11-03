# Journal — droits d'écriture des missions (session recette b7)

## 2026-11-03T09:13:00+01:00 — #129 : PATCH /api/missions/:id réservé aux gestionnaires

- **Quoi** : `authorize([...MISSION_MANAGER_ROLES])` sur `PATCH /api/missions/:id` (admin, logistics, secretary). Boutons **Modifier** et **Budgets mission** masqués hors gestionnaires. `MISSION_FUEL_MANAGERS` (serveur) et `canManageMissionFuel` (client) dérivés de `MISSION_MANAGER_ROLES`, au lieu d'une copie de la liste.
- **Comment** : la garde est posée sur la déclaration de la route. Le contrat `tests/contract/mission-patch-roles.contract.test.ts` dérive les rôles refusés de `ALL_APP_ROLES` moins les gestionnaires ; le corps hostile porte coût, budgets (`workflowData.budgetPlan`), dates, chauffeur et véhicule. Nouveau garde-fou `tests/unit/server/write-route-guards.test.ts` : toute route d'écriture de `server/api/` déclare ses rôles, 45 routes existantes gelées.
- **Pourquoi** : le routeur était monté derrière `isStaff` seulement ; un chauffeur, un technicien, un magasinier, la direction ou l'atelier pouvaient modifier une mission, budgets compris. Décision utilisateur (option a, 3 novembre 2026) : le chauffeur n'écrit pas les budgets ; s'il en manque, un gestionnaire les saisit avant le départ.
- **Comment tester (QA)** : se connecter en chauffeur affecté, ouvrir la mission : pas de bouton Modifier ni Budgets. En logistique, les deux boutons sont présents et l'enregistrement passe.
- **RAIDER** : R (une constante partagée, consommée partout) ; D (contrat 1175/1175 sur la branche, unitaires verts) ; failure memory (LESSONS_LEARNED, 3e occurrence, cliquet automatique) ; I, A, R rétroactif sans objet (aucune donnée, aucune migration).
- **Reste/risques** : `POST /api/missions`, `PUT /:id/status` et `POST /api/operations/missions/from-fuel` restent ouverts au personnel. Ils sont traités au lot 2, après la fusion de #131, et visibles dans la liste gelée.

## 2026-11-03T09:28:45+01:00 — #129 : trois faux verts du garde-fou corrigés

- **Quoi** : `tests/support/write-route-scan.ts` ne compte plus `isAnyUser` comme garde (il charge req.user sans restreindre de rôle). Il scanne aussi les receveurs `xxxRoutes` (work-order-items.routes.ts) et lit les déclarations sur plusieurs lignes jusqu'au premier handler. Liste gelée : 45 -> 54 routes (alerts x3, incidents, notification-settings, work-order-items x4).
- **Comment** : arguments de l'appel lus par profondeur de parenthèses ; chemin non littéral noté tel qu'écrit ; receveur ajouté à l'identifiant quand il n'est pas `router`. Nouveau test : le nombre de routes vues égale un compte grossier des `.post/.put/.patch/.delete` (hors `db.`), plus trois cas sur extrait. Mutation : `isAnyUser` à la place de `authorize` sur `PATCH /:id` fait échouer le test.
- **Pourquoi** : relecture de #129 (c7, décision 0a) : un garde-fou qui laisse passer des cas ne doit pas entrer sur main.
- **Comment tester (QA)** : `npx vitest run tests/unit/server/write-route-guards.test.ts` (7 tests).
- **RAIDER** : D (unitaires 1544/1544, tsc 0) ; failure memory (le cliquet couvre désormais les formes de déclaration réelles) ; R, A, I sans objet.
- **Reste/risques** : une garde nommée autrement qu'`authorize`/`isXxx` reste comptée comme absente (faux rouge, pas faux vert).
