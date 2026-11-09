## Piste D, relecture : les cliquets jugent la route réellement servie

**Quoi**
- `write-routes-scan.ts` (`allWriteRoutes`) lisait `routes.ts` d'abord. Or `server/app.ts` monte `apiRouter` avant `registerRoutes` : Express sert la version de `server/api`. Les routeurs sont maintenant lus dans l'ordre de montage de `server/api/index.ts` (`mountOrder`), `routes.ts` en dernier.
- Un garde qui rend la main par `next()` sans répondre (`admin-users-guard.routes.ts`) ne masque plus la vraie route : il est écarté (`isPassThrough`) et ses middlewares (`isAdmin`) sont prêtés à la déclaration servie.
- Listes gelées : T1 perd `post /api/fuel-card/consumption` ; T3 et T4 perdent `post /api/workflows/vehicle-acquisition` et `patch /api/workflows/vehicle-acquisition/:sessionId`. Aucune entrée ajoutée : aucune route servie non gardée n'est apparue.
- Non fait : les clés issues de gabarits (`relative(alertPath(":id"))`) restent telles quelles ; les résoudre demande de lire les constantes de chemin, pas simple.

**Comment**
- `tests/unit/server/write-routes-ratchet.test.ts` : l'ordre `app.use("/api", apiRouter)` avant `registerRoutes`, la version servie de `fuel-card/consumption` vient de `api/fuel-card.routes.ts` et est gardée, ordre de montage, garde `next()` (détection et prêt de middlewares).

**Pourquoi**
- Les cliquets jugeaient la version morte de routes dupliquées : une route servie gardée figurait comme non gardée, et inversement une route non gardée pouvait échapper.

**Preuve**
- Rouge avec `routes.ts` remis en premier : 4 échecs (ordre, T1, T3, T4). Vert avec l'ordre corrigé : 15/15.

