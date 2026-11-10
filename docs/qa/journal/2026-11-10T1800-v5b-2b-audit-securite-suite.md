## 2026-11-10 18:00 - V5b-2b : audit sécurité et relecture (commits 0aaaa7c2, fa78e0e5 et suite)

**Quoi.**
- 0aaaa7c2 : première livraison de V5b-2b (voir l'entrée de 17:30) plus l'inscription de `offlineOwnerGuard` dans le test de garde de préfixe.
- fa78e0e5 : `routeExample` exigé par le registre dans `offline-replay-gate.test.ts` (le job `check:tests` du CI était rouge).
- Suite, audit sécurité : CORS (`Idempotency-Key` et `X-Offline-Owner` autorisés, `Idempotent-Replayed` exposé, noms importés de `shared/idempotency-routes.ts`) pour l'application mobile en `https://localhost` ; la route de l'envoi doit être celle de son type (`sameProtectedRoute`) ; date de création par défaut (absente, 0 ou NaN) ; test de rétention comparant la constante à l'intervalle SQL des trois endroits ; prérequis d'allumage dans `docs/plans/v5b-chauffeur-hors-ligne.md`.
- Suite, relecture : plafond des 409 "en cours" dérivé de `IDEMPOTENCY_STALE_SECONDS` (déplacé en source partagée) plus 60 s de marge ; test de l'abonnement `session-changed` ; repli `AbortController` quand `AbortSignal.timeout` manque.

**Pourquoi.** Sans CORS, le preflight de l'APK refuse les deux en-têtes ; un type qui vise la route protégée d'un autre type contournait le registre ; un plafond sous le délai de reprise serveur passait À revoir trop tôt ; un vieux WebView sans `AbortSignal.timeout` aurait réessayé sans fin.

**Tester.** `node node_modules/vitest/vitest.mjs run tests/unit/client --reporter=dot` ; contrat CORS et propriétaire : `tests/contract/offline-owner-guard.contract.test.ts` sous `db-lock`.
