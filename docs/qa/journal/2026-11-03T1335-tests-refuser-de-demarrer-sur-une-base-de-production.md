## 2026-11-03 13:35 — Tests : refuser de démarrer sur une base de production

- **Quoi** : intégration, contrat et unitaires refusent de démarrer si `DATABASE_URL` (ou `_LISTENER`, `_DIRECT`) diffère de `DATABASE_URL_TEST`, si celui-ci manque (plus de repli), ou si l'hôte est interdit (`TEST_DB_FORBIDDEN_HOSTS`, `*.neon.tech` sauf `ALLOW_NEON_TEST_DB=1`).
- **Comment** : fonctions pures ajoutées à `e2e/helpers/production-guard.ts` (pas de second module), branchées dans `setup-db.ts` et un nouveau `setup-unit.ts` ; `--env-file=.env` retiré de `test:integration` et `test:contract`. CI inchangée (elle ne définit que `DATABASE_URL_TEST`).
- **Pourquoi** : near miss, contrat lancé avec le `.env` de production (voir `LESSONS_LEARNED.md`, 2026-11-03).
- **Preuves** : `tests/unit/server/test-db-guard.test.ts`, rouge sur le code d'avant, vert après ; essai manuel : `DATABASE_URL=postgres://u:p@ep-x.neon.tech/db` fait échouer un contrat avant toute connexion ; contrat `vehicle-documents-client-scope` 19/19 sur la base locale.

