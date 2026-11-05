# Journal aa-rpa

## 2026-11-05 03:25 — garde router.param lue sur l'AST

- Quoi : `tests/unit/server/router-param-strict.test.ts` passe d'une recherche textuelle de `return next()` à une lecture AST (patron des gardes multer). Tout `<x>.param(nom, callback)` de `server/` (hors `_archive`) doit appeler `parseX(value)` au premier niveau du corps ou d'un `try`, et tout `next()` / `next("route")` doit venir après. `parseInt` / `parseFloat` sont refusés ; un parseur local doit contenir un `throw`.
- Comment : `scanRouterParams(file, text)` exporté ; 9 formes refusées et 3 acceptées en cas synthétiques ; contrôle « pas aveugle » sur la garde de missions.
- Pourquoi : `if (…) { next(); return; }` avant le parsage passait l'ancienne garde, qui ne voyait que `return next()`.
- Tester : mutation `if (!/^\d+$/.test(String(value))) { next(); return; }` insérée avant `parseMissionId(value)` dans `missions.routes.ts` : ancienne garde verte (2/2), nouvelle rouge (1 échec) ; fichier restauré, nouvelle garde verte (4/4).
