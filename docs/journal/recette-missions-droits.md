# Journal — droits d'écriture des missions (session recette b7)

## 2026-11-03T09:13:00+01:00 — #129 : PATCH /api/missions/:id réservé aux gestionnaires

- **Quoi** : `authorize([...MISSION_MANAGER_ROLES])` sur `PATCH /api/missions/:id` (admin, logistics, secretary). Boutons **Modifier** et **Budgets mission** masqués hors gestionnaires. `MISSION_FUEL_MANAGERS` (serveur) et `canManageMissionFuel` (client) dérivés de `MISSION_MANAGER_ROLES`, au lieu d'une copie de la liste.
- **Comment** : la garde est posée sur la déclaration de la route. Le contrat `tests/contract/mission-patch-roles.contract.test.ts` dérive les rôles refusés de `ALL_APP_ROLES` moins les gestionnaires ; le corps hostile porte coût, budgets (`workflowData.budgetPlan`), dates, chauffeur et véhicule. Nouveau garde-fou `tests/unit/server/write-route-guards.test.ts` : toute route d'écriture de `server/api/` déclare ses rôles, 45 routes existantes gelées.
- **Pourquoi** : le routeur était monté derrière `isStaff` seulement ; un chauffeur, un technicien, un magasinier, la direction ou l'atelier pouvaient modifier une mission, budgets compris. Décision utilisateur (option a, 3 novembre 2026) : le chauffeur n'écrit pas les budgets ; s'il en manque, un gestionnaire les saisit avant le départ.
- **Comment tester (QA)** : se connecter en chauffeur affecté, ouvrir la mission : pas de bouton Modifier ni Budgets. En logistique, les deux boutons sont présents et l'enregistrement passe.
- **RAIDER** : R (une constante partagée, consommée partout) ; D (contrat 1175/1175 sur la branche, unitaires verts) ; failure memory (LESSONS_LEARNED, 3e occurrence, cliquet automatique) ; I, A, R rétroactif sans objet (aucune donnée, aucune migration).
- **Reste/risques** : `POST /api/missions`, `PUT /:id/status` et `POST /api/operations/missions/from-fuel` restent ouverts au personnel. Ils sont traités au lot 2, après la fusion de #131, et visibles dans la liste gelée.
