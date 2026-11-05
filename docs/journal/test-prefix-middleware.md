# Journal — Test (`test-prefix-middleware`)

Branche : `test/prefix-middleware-guardrail`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-11-05T04:50:00+01:00 — Garde-fou : middlewares montés sur un préfixe

- **Agent** : test · **Branche** : `test/prefix-middleware-guardrail` · **Commit** : voir `git log -1`
- **Statut** : fait
- **Quoi** : `tests/support/prefix-middleware-scan.ts` (recensement par AST TypeScript) et `tests/unit/server/prefix-middleware-guardrail.test.ts` (liste blanche justifiée, 8 tests, sans base).
- **Comment** : le recensement lit `.use(` de `app`, `apiRouter` et `router` dans tout `server/` (hors `_archive`), plus les chaînes de middlewares des verbes dans `server/app.ts` et `server/api/index.ts`. Les routeurs montés (`*Routes`, `*Router`) sont ignorés. Chaque middleware est classé après lecture de son source : garde de rôle, sans base, écrit après la réponse, indexé par session, pré-authentification, hors `/api`. Une dérogation suivie (voir PR liée) et une entrée attendue absente (`routeIdRangeGuard`) sont dans des listes séparées.
- **Pourquoi** : un middleware monté sur un préfixe s'exécute avant les gardes de rôle des routes ; sans inscription, un accès base ajouté là passe inaperçu.
- **Comment tester (QA)** :
  - Étapes : 1. `node node_modules/vitest/vitest.mjs run --reporter=dot tests/unit/server/prefix-middleware-guardrail.test.ts`. 2. Ajouter `apiRouter.use("/x", fooMiddleware);` dans `server/api/index.ts`, relancer, puis annuler (`git checkout server/api/index.ts`).
  - Attendu : 1. 8 tests verts. 2. un test rouge qui cite `server/api/index.ts:<ligne> apiRouter.use("/x", fooMiddleware)` et indique où inscrire.
  - Preuve : rouge constaté avec le montage fictif (1 échec, 7 verts), vert après retrait (8 verts).
- **RAIDER** : D couvert (aucun code produit modifié) ; R : nouvelles règles dans une liste, pas dans le scanner ; I : lecture seule ; failure memory : prévention vérifiable par ce test.
- **Reste / risques** : une dérogation suivie dans une PR liée (liste séparée du test).
