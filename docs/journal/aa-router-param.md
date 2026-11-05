# Journal aa-router-param

## 2026-11-05 03:25 — garde router.param lue sur l'AST

- Quoi : `tests/unit/server/router-param-strict.test.ts` passe d'une recherche textuelle de `return next()` à une lecture AST (patron des gardes multer). Tout `<x>.param(nom, callback)` de `server/` (hors `_archive`) doit appeler `parseX(value)` au premier niveau du corps ou d'un `try`, et tout `next()` / `next("route")` doit venir après. `parseInt` / `parseFloat` sont refusés ; un parseur local doit contenir un `throw`.
- Comment : `scanRouterParams(file, text)` exporté ; 9 formes refusées et 3 acceptées en cas synthétiques ; contrôle « pas aveugle » sur la garde de missions.
- Pourquoi : `if (…) { next(); return; }` avant le parsage passait l'ancienne garde, qui ne voyait que `return next()`.
- Tester : mutation `if (!/^\d+$/.test(String(value))) { next(); return; }` insérée avant `parseMissionId(value)` dans `missions.routes.ts` : ancienne garde verte (2/2), nouvelle rouge (1 échec) ; fichier restauré, nouvelle garde verte (4/4).

## 2026-11-05 03:30 — réserves de relecture de #363

- Quoi : la garde compte comme passage `next` avec une valeur fausse (`null`, `undefined`, `void 0`, `false`, `0`, `""`), et signale illisible un `.param` dont le nom n'est pas une chaîne littérale (`param(["id"], cb)`, `param(variable, cb)`). L'en-tête liste les faux négatifs connus : alias de `next`, `next` passé à une fonction imbriquée ou différée (`setImmediate(next)`), `.param (` avec une espace. La prévention de LESSONS_LEARNED (« Une garde refuse ce qu'elle ne sait pas lire ») décrit maintenant la garde AST. Ce journal, nommé d'abord `aa-rpa.md`, prend un nom de chantier lisible (`aa-router-param.md`), sur le modèle de `c7-argent.md` et `cdc-mileage-driver-scope.md`.
- Comment : `isPassArgument` dans `passCalls` ; 6 passages faux et 2 noms non littéraux ajoutés aux cas synthétiques.
- Pourquoi : Express traite `next(null)` comme `next()` : la forme passait avant le parsage sans être vue.
- Tester : mutation `if (!value) { next(null); return; }` avant `parseMissionId(value)` : rouge (1 échec), puis vert (4/4) une fois le fichier restauré.
