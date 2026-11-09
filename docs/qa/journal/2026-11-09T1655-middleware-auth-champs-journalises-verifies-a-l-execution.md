## 2026-11-09T16:55:00+01:00 — Middleware auth : champs journalisés vérifiés à l'exécution, rôle brut ajouté

- **Statut** : fait (PR brouillon)
- **Quoi** :
  - `server/middleware/auth.ts` : `rawRole: user.role` ajouté aux journaux de `authorize` (refus et accès). `normalizeRole` ramène tout rôle inconnu à `user`, un 403 dû à un rôle mal saisi était sinon indiagnosticable ;
  - `tests/unit/server/auth-log-fields.test.ts` : exécute `authenticate` et `authorize` sur une requête piégée (cookie, Authorization, jeton en query, mot de passe en corps, identifiant de session) avec les vraies `loggerOptions` au niveau debug sur un flux capturé. Chaque ligne n'a que les clés module, service, level, time, msg, requestId, method, path, hasSession, userId, role, rawRole, allowedRoles ; aucune valeur sensible n'apparaît ;
  - `auth-no-console.test.ts` : l'extraction des appels de journal est limitée à chaque appel (une ligne, ou jusqu'à la première ligne `)`), au lieu d'avaler le code suivant.
- **Comment tester (QA)** : `npx vitest run tests/unit/server/auth-log-fields.test.ts tests/unit/server/auth-no-console.test.ts`. Rouge avec `{ req }` ajouté au journal de `authenticate` (3 tests) et avec `user` ajouté au refus 403 (1 test) ; rouge avec un `console.log` réintroduit ; vert sinon.
- **RAIDER** : D : statuts inchangés ; failure memory : garde d'exécution contre la fuite d'objets entiers dans les journaux.
- **Reste / risques** : la garde ne couvre que `authenticate` et `authorize` (pas `isAdmin`, qui ne journalise qu'en erreur).

