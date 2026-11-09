## 2026-11-03 17:40 — Garde : routes de routes.ts masquées par server/api/

- **Quoi** : `scanShadowedRoutes` (`tests/support/route-guard-scan.ts`) compare méthode et chemin complet, paramètres anonymisés, entre les routeurs montés dans `server/api/index.ts` et les `app.*` de `server/routes.ts`. `routes-hygiene` fige la liste en égalité stricte : 15 doublons.
- **Pourquoi** : `apiRouter` est monté avant `registerRoutes`, donc la déclaration de `routes.ts` dort avec ses gardes. Cas réel : `POST /api/fuel-card/consumption` acceptait un prix client sous `authenticate` (supprimé par #201).
- **Preuves** :
  - rouge si une entrée est retirée de la liste ;
  - unitaires 1886/1886 ;
  - tsc 0.
