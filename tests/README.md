# Tests automatisés — pyramide

Les tests **ne vivent pas** à côté du code de production (`client/`, `server/`, `shared/`).

| Couche | Dossier | Runner | Base |
|--------|---------|--------|------|
| Unitaire | `tests/unit/` | `npm test` (`vitest.config.ts`) | aucune |
| Intégration | `tests/integration/` | `npm run test:integration` (`vitest.integration.config.ts`) | `DATABASE_URL_TEST` |
| Contrat HTTP | `tests/contract/` | `npm run test:contract` (`vitest.contract.config.ts`) | `DATABASE_URL_TEST` |
| E2E UI | `e2e/` | `npm run test:e2e` | voir `e2e/README.md` |

## Commandes

```bash
npm test                 # unitaires seulement — pas de Neon
npm run test:integration # services + Postgres TEST
npm run test:contract    # HTTP in-process (createApp) + Zod/status
npm run test:all         # unit + integration + contract (pas e2e)
npm run test:e2e         # Playwright
```

## Base utilisée

Même Neon que `npm run dev` (`DATABASE_URL`). Pas de copie, pas de « branche » Neon.

Les factories créent des lignes préfixées `TEST-` (username, immat, référence pièce…). `afterEach` les supprime ; un filet `afterAll` enlève d'éventuels orphelins `TEST-*` si un test a crashé.

`DATABASE_URL_TEST` dans `.env` pointe vers **la même URL**. Si la variable manque, on retombe sur `DATABASE_URL`.

## Pattern

AAA + factory. Un test qui fait `if (rows.length > 0)` ne teste rien : créer la donnée, ou échouer.

Règle d'or : un bug SQL se rattrape en intégration, un 403 en contrat, un graphe de statut en unitaire. L'e2e ne sert pas à découvrir un UNIQUE.

Un `it.fails` / `test.fail` ne contient que l'appel visé et l'assertion métier : la mise en place (création, POST de fixture, `save()`) va dans `beforeAll` ou un `it` témoin, sinon un setup en échec le fait passer au vert. Garde-fou : `tests/unit/server/it-fails-hygiene.test.ts` (liste gelée).
