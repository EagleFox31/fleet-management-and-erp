## 2026-11-10 17:30 - V5b-2b : propriétaire par envoi et routes protégées

**Quoi.** Suite de #645. En-tête `X-Offline-Owner` sur chaque envoi différé, garde serveur générique (409 `OFFLINE_OWNER_MISMATCH`, classé auth côté client), diffusion `session-changed` entre onglets. Liste des routes protégées déplacée dans `shared/idempotency-routes.ts` ; la file ne rejoue que ces routes (`odometer_reading` passe en PUT, `work_order_note` retiré). Mineurs : plafond de 12 réponses 409 « en cours », envoi plus vieux que la rétention serveur moins un jour refusé, clé validée à la mise en file, délai d'envoi sous le bail, endpoint sous `/api/`, `pendingSendCount` hors drapeau, bases IndexedDB vidées supprimées.

**Comment.** Garde Express placé avant `idempotencyGuard`, comparaison à `req.session.userId`, aucun identifiant dans le log. Rétention : constante `IDEMPOTENCY_RETENTION_DAYS`, un test fige schéma et bootstrap SQL sur la même durée.

**Pourquoi.** Le cookie est partagé entre onglets : le propriétaire vérifié avant la boucle ne couvre pas la boucle (voir LESSONS_LEARNED). Le drapeau `offline-writes` reste coupé ; revue sécurité requise avant de l'allumer ou de brancher un écran.

**Tester.** `node node_modules/vitest/vitest.mjs run tests/unit/client --reporter=dot` ; contrat : `DATABASE_URL_TEST=... node ../lot-tools/db-lock.mjs <agent> -- node node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/offline-owner-guard.contract.test.ts`.
