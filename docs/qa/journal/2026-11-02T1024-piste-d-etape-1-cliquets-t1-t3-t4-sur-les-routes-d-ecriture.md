## Piste D, étape 1 : cliquets T1, T3, T4 sur les routes d'écriture

**Quoi**
- `tests/unit/server/write-routes-ratchet.test.ts` (12 cas, sans base) : analyse statique de toutes les routes POST/PUT/PATCH/DELETE de `server/routes.ts` et `server/api/*.routes.ts` (138 routes après dédoublonnage, Express servant la première déclaration). Trois cliquets : T1 garde de rôle (23 routes gelées), T3 validation du corps (32 sur 88 qui lisent `req.body`), T4 protection des champs serveur (32).
- `tests/unit/server/support/write-routes-scan.ts` (détection, préfixe de montage par routeur, y compris les routeurs multiples de `work-order-items.routes.ts`) et `support/write-routes-frozen.ts` (les trois listes).
- Plan : T1, T3, T4 passent à « OK avec cliquet ».

**Comment**
- Même principe que `vehicle-routes-guard` et `routes-hygiene` : liste gelée, échec dans les deux sens (nouvelle route non conforme, ou entrée gelée devenue conforme). Le message nomme la route et dit quoi faire.
- Ne sont pas des gardes de rôle : `authenticate`, `isAnyUser`, `requireFeature`, `requireAuth`, `checkAuth`, téléversement. Garde au montage (`apiRouter.use("/x", isStaff, ...)`) comptée.
- Limite : texte seulement. Un handler passé par référence n'est pas lu pour T3/T4 ; un contrôle fait dans une fonction appelée n'est pas vu (la route reste gelée). Premier passage : le téléversement `upload.single` était pris pour une garde (regex corrompue), la route `post /api/workflows/:sessionId/documents` a été révélée par le test lui-même puis gelée.

**Pourquoi**
- T1, T3 et T4 n'ont pas de fin naturelle (« toute route ») : un cliquet fige l'existant et interdit la régression, au lieu d'un test par route.

**Preuve**
- Rouge : route factice `app.post("/api/zz-fake", authenticate, ... values(req.body))` ajoutée temporairement à `server/routes.ts` : 3 cas échouent (T1, T3, T4) en nommant `post /api/zz-fake`. Entrée gelée inexistante ajoutée : le cas T1 échoue (« la liste ne peut que rétrécir »). Retirés : 12/12 vert.
- `tsc` global : 0 erreur. `npm test` : 82 fichiers, 895 tests verts (avant : 81 fichiers, 883).
- À examiner par fleet-api (non corrigé ici) : `server/routes.ts:5178` `post /api/test-date-maintenance` (route de test accessible à tout compte connecté) ; `server/api/document-renewals.routes.ts:861` `post /quick-renew` sans garde de rôle.


