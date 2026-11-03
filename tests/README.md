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

`DATABASE_URL_TEST` doit viser une **branche Neon de test**, passée en variable d'environnement au lancement (sans modifier `.env`). Si la variable manque, les suites **refusent de démarrer** (aucun repli sur `DATABASE_URL`).

### Postgres local (plus rapide que Neon)

La latence vers Neon domine la durée des suites intégration et contrat (sérialisées, un seul worker). Un Postgres
Docker sur la machine les accélère sans changer les tests : même `initializeDatabase()`, même nettoyage.
Le driver Neon dialogue en WebSocket, d'où le second conteneur `wsproxy` (`docker-compose.test.yml`).

```bash
npm run test:db:up        # conteneurs + schéma Drizzle (`test:db:schema`, drizzle-kit push sur le port 54320)
DATABASE_URL_TEST=postgres://fleet:fleet@postgres:5432/fleet_test DATABASE_WS_PROXY=localhost:5433/v1 npm run test:contract
npm run test:db:down      # supprime aussi le volume
```

`initializeDatabase()` ne crée pas les tables (il suppose un `drizzle-kit push` initial) : d'où l'étape schéma
avant la première suite. Elle est idempotente, la rejouer ne change rien.

PowerShell : `$env:DATABASE_URL_TEST="postgres://fleet:fleet@postgres:5432/fleet_test"; $env:DATABASE_WS_PROXY="localhost:5433/v1"; npm run test:contract`.

Plusieurs sessions ou agents en parallèle : une base dédiée chacun dans le même conteneur, jamais `fleet_test` partagée. Un `drizzle-kit push` d'une autre branche y change le schéma entre deux passages et fait échouer des tests sains (échec labor-catalog non reproduit, novembre 2026).

```bash
docker compose -f docker-compose.test.yml exec postgres createdb -U fleet fleet_test_<session>
DATABASE_URL=postgres://fleet:fleet@localhost:54320/fleet_test_<session> node node_modules/drizzle-kit/bin.cjs push --force
DATABASE_URL_TEST=postgres://fleet:fleet@postgres:5432/fleet_test_<session> DATABASE_WS_PROXY=localhost:5433/v1 npm run test:contract
```

Repousser le schéma à chaque changement de branche. Supprimer la base en fin de chantier (`docker compose -f docker-compose.test.yml exec postgres dropdb -U fleet fleet_test_<session>`), pas avec `test:db:down`, qui détruit le volume de tout le monde.

- `DATABASE_WS_PROXY` (sans protocole) bascule `server/db.ts` sur le proxy en clair ; absent = Neon, inchangé.
- L'hôte `postgres` de l'URL est résolu par wsproxy dans le réseau Compose, pas par Node : ne pas le remplacer par `localhost`.
- Les variables d'environnement priment sur `.env` (`node --env-file`), pas besoin de modifier le fichier.
- Le `tmpfs` du conteneur repart vide à chaque `up` : les tables sont recréées par `test:db:schema`
  (appelé par `test:db:up`), pas par `initializeDatabase()`, qui suppose le schéma déjà poussé.

La CI (`.github/workflows/ci.yml`) utilise le même montage en `services:`, avec le contrat découpé en shards vitest
(`--shard=i/n`), une base par shard.

**Garde-fou** : `tests/support/setup-db.ts` (intégration, contrat) et `tests/support/setup-unit.ts` (unitaires) appellent `e2e/helpers/production-guard.ts` et refusent de démarrer si `DATABASE_URL`, `DATABASE_URL_LISTENER` ou `DATABASE_URL_DIRECT` diffère de `DATABASE_URL_TEST`, si `DATABASE_URL_TEST` manque, ou si l'hôte est interdit : `TEST_DB_FORBIDDEN_HOSTS` (liste à virgules), `E2E_PRODUCTION_DB_MARKERS`, ou tout `*.neon.tech` sauf `ALLOW_NEON_TEST_DB=1`. Les scripts `test:integration` et `test:contract` ne chargent plus `.env` : ne jamais l'ajouter. Cas : `tests/unit/server/test-db-guard.test.ts`.

## Pattern

AAA + factory. Un test qui fait `if (rows.length > 0)` ne teste rien : créer la donnée, ou échouer.

Règle d'or : un bug SQL se rattrape en intégration, un 403 en contrat, un graphe de statut en unitaire. L'e2e ne sert pas à découvrir un UNIQUE.

Un `it.fails` / `test.fail` ne contient que l'appel visé et l'assertion métier : la mise en place (création, POST de fixture, `save()`) va dans `beforeAll` ou un `it` témoin, sinon un setup en échec le fait passer au vert. Garde-fou : `tests/unit/server/it-fails-hygiene.test.ts` (liste gelée).

Pas de `vi.mock` / `vi.doMock` dans `tests/contract` : la config contrat tourne en `isolate: false` (une app et un pool par processus, volontaire), le mock ne s'applique que si aucun fichier précédent du shard n'a chargé le module. Simuler la panne en base (trigger temporaire levant `23505`, voir `document-renewal-centers.contract.test.ts`) ou par injection de dépendance. Garde-fou : `tests/unit/server/contract-no-vi-mock.test.ts`.
