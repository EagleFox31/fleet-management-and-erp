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

## Reserves de relecture R1 a R6

Quoi : le recensement des middlewares montes sur un prefixe devient plus strict sur six points.
Comment : chaque point a un test sur source synthetique et, quand le code reel le permet, un test sur `server/`.
- R1 derogation perimee : `staleDerogations` signale toute derogation (nom + fichier) sans montage reel. Rouge : une derogation fantome fait echouer le test.
- R2 « sans base » : analyse AST des imports (statique, re-export, `import()`, `require`) vers db, storage, services, drizzle, neon, pg ; une entree sans-base du projet doit citer sa `source` (bibliotheques exemptees).
- R3 `routeIdRangeGuard` : s'il est monte, il l'est sans prefixe, sur `apiRouter`, avant le premier routeur (`routeIdGuardIssues`).
- R4 routeurs : reconnus par leur declaration (`Router()`) ou leur import (`*.routes`), non par un suffixe de nom. Rouge : un suffixe de nom laisse passer `fooRoutes`, une fonction qui n'est pas un routeur.
- R5 `requireFeature` : entree restreinte a `server/api/index.ts` au lieu de valoir partout.
- R6 receveurs : decouverts par leur declaration (`Router()`, `express.Router()`, `express()`), en plus des trois noms connus.
Pourquoi : une liste blanche qui survit au code, un nom qui sert de preuve ou un receveur oublie laissent passer un middleware avant les gardes de role. Lecture des reserves faite a partir de leur resume (texte exact non disponible) : interpretation a confirmer en relecture.
Ajout lie : `/health/details` (route de main, `isAdmin` en tete de chaine) inscrit comme gestionnaire final.

## Lot de suivi : imports transitifs, routeIdRangeGuard, routeurs importes, receveurs types

- **Quoi** : le scanner `tests/support/prefix-middleware-scan.ts` lit les modules relatifs (`ReadModule`) et la garde ne repose plus sur le seul texte du fichier de montage.
- **R2** : `forbiddenImportsDeep` suit les imports relatifs (chaine `a.ts > b.ts > ../db`, cycles surs) ; `forbiddenInAnonymousMounts` analyse le corps des fonctions anonymes montees via leurs identifiants importes ; `importSourceOf` verifie que la `source` inscrite est le module reellement importe (ou la fabrique importee dont la constante locale est issue).
- **R3** : `routeIdRangeGuard` est accepte dans `server/api/index.ts` (apiRouter, sans prefixe) ou `server/app.ts` (app, sans prefixe ou `/api`), avant le premier routeur ; tout autre fichier, receveur ou prefixe echoue. `firstRouterMountLine` compte aussi `apiRouter`, les imports nommes et `registerRoutes(app)`.
- **R4** : un import nomme depuis un module `*.routes` n'est un routeur que si ce module l'exporte comme tel ; sinon il est recense comme middleware.
- **R6** : un receveur se decouvre aussi par son type declare (`Router`, `Express`, `Application`, `IRouter`) et par une fabrique typee.
- **Mineur** : `ATTENDUS_TOLERES_ABSENTS` porte un `file` optionnel ; la tolerance est propre a son fichier.
- **Pourquoi** : reserves de relecture de #384 ; chaque cas est couvert par un test sur source synthetique, plus un controle sur le code reel.
