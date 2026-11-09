## 2026-11-03 13:19 — apiErrorProblems vérifie le requestId

- **Quoi** : `apiErrorProblems` (`tests/support/api-error.ts`) exige maintenant un `requestId` non vide dans le corps d'erreur. Si l'appelant fournit l'en-tête `X-Request-Id` de la réponse, il doit être identique (`null` = en-tête absent, c'est un écart). Les trois contrats consommateurs (parts-catalog-access-errors, operations-driver-scope, mission-fuel-errors) et l'e2e 13 passent l'en-tête.
- **Comment** : cinquième paramètre optionnel `requestIdHeader`, signature existante inchangée. `contract-session.call` expose `headers` (ajout, même forme que `contract-actors`).
- **Pourquoi** : contrat `ApiErrorBody` (`shared/errors.ts`). Le requestId est la référence que l'utilisateur donne au support (AGENTS.md §10), et rien ne le gardait.
- **Preuves** : unitaire 6/6, rouge à 2/6 avec l'ancien contrôle. Mutation serveur (`normalizeErrorBody` sans requestId) : 17 tests de contrat rouges sur les 3 suites consommatrices, verts une fois le serveur rétabli. Contrats complets 1340/1340 sur fleet_test_de_rid. Unit 1660/1660, tsc 0. Aucune route sans requestId parmi celles qu'appellent ces suites.

