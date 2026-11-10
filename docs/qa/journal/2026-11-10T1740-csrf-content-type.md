## Anti-CSRF : écritures /api en JSON ou multipart seulement


**Quoi** : middleware `server/middleware/require-json-content-type.ts`, monté dans `server/app.ts` avant `express.json` et `express.urlencoded`. Toute POST /api exige `application/json` ou `multipart/form-data` (corps ou non) ; PUT, PATCH, DELETE l'exigent dès qu'un corps est joint. Sinon `AppError(415)`. `codeForStatus(415)` donne `VALIDATION`.
**Pourquoi** : cookie de session `SameSite=None`, aucun jeton CSRF, `express.urlencoded` global. Un formulaire tiers POSTait en urlencoded (requête simple, sans préflight) sur des routes à schéma coercitif (`/api/fuel-records`, `/api/parts/:id/update-stock`, `/api/driver/breakdowns`) avec les cookies de la victime.
**Comment** : contrat `tests/contract/csrf-content-type.contract.test.ts` (rouge sans le garde : 4 échecs sur 7, écritures effectives ; vert avec), unitaire de la matrice, entrée du garde-fou des middlewares préfixés. Client : `apiRequest` pose `Content-Type: application/json` sur une écriture sans corps. Helper de contrat `call` idem.
**Exceptions** : aucune (aucun webhook entrant, aucune écriture hors /api).
**Reste** : `SameSite`, contrôle d'`Origin`/`Sec-Fetch-Site` (multipart reste forgeable depuis un formulaire), retrait d'`express.urlencoded` : voir la PR.
