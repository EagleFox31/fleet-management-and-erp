## Piste C, étape 1 : garde-fou e2e contre la production

**Quoi**
- `e2e/helpers/production-guard.ts` et son appel en tête de `playwright.config.ts` : Playwright refuse de démarrer quand la base visée est la production (hôte contenant l'endpoint Neon de production, ou un marqueur de `E2E_PRODUCTION_DB_MARKERS`). Message actionnable, sans URL ni mot de passe.
- `tests/unit/e2e/production-guard.test.ts` (10 cas) : extraction de l'hôte, pooler ou non, marqueur cherché dans l'hôte seulement, liste étendue par variable, repli sur le `.env`, priorité de la variable d'environnement, message sans secret, appel présent dans la config.

**Comment**
- Fonction pure, entrées injectables (`env`, lecture du `.env`) : testable sans base ni Playwright. La liste par défaut n'est qu'un plancher, la variable l'étend (RAIDER Agnostic).

**Pourquoi**
- Le `.env` racine pointe `DATABASE_URL` et `DATABASE_URL_TEST` sur la production ; les specs 07, 08, 10 à 14 créent et suppriment des lignes. Un oubli suffisait pour écrire en production.

**Preuve**
- Unitaire 10/10. `DATABASE_URL=<endpoint de production> node node_modules/@playwright/test/cli.js test --list` : échec immédiat avec le message du garde-fou (sans le garde-fou, la liste des specs s'affiche). Avec une branche de test : la config se charge.


