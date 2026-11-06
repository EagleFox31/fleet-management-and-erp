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

`npm test` refuse de démarrer si un `DATABASE_URL` Neon est encore exporté dans le shell (garde de #159). Le désactiver avant de lancer les tests : `unset DATABASE_URL` (bash), ou `Remove-Item Env:DATABASE_URL` (PowerShell).

## Base utilisée

Intégration et contrat : le Postgres local Docker (voir plus bas), jamais le Neon de `npm run dev` (`DATABASE_URL`). Seuls les e2e écrivent sur la base pointée par `DATABASE_URL`.

Les factories créent des lignes préfixées `TEST-` (username, immat, référence pièce…). `afterEach` les supprime ; un filet `afterAll` enlève d'éventuels orphelins `TEST-*` si un test a crashé.

`DATABASE_URL_TEST` vise le Postgres local (ou, exceptionnellement, une **branche Neon dédiée aux tests** avec `ALLOW_NEON_TEST_DB=1`). Elle est passée en variable d'environnement au lancement, jamais lue depuis `.env`. Si elle manque, les suites **refusent de démarrer** (aucun repli sur `DATABASE_URL`).

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

Avant intégration ou contrat : `unset DATABASE_URL` (PowerShell : `Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue`). `DATABASE_URL_TEST` s'exporte, il n'est plus lu depuis `.env`. Si on l'oublie :

```
Tests refusés : DATABASE_URL (hôte « <hôte> ») diffère de DATABASE_URL_TEST (hôte « postgres:5432 »).
```
ou, sans `DATABASE_URL_TEST` : `Tests refusés : DATABASE_URL_TEST est requis pour les suites d'intégration et de contrat.`
Les e2e et les scripts `backfill:*` / `benchmark:*` ne passent pas par ce garde-fou (`playwright.config.ts:5` garde sa propre vérification).

Plusieurs sessions ou agents en parallèle : une base dédiée chacun dans le même conteneur, jamais `fleet_test` partagée. Un `drizzle-kit push` d'une autre branche y change le schéma entre deux passages et fait échouer des tests sains (échec labor-catalog non reproduit, novembre 2026).

```bash
docker compose -f docker-compose.test.yml exec postgres createdb -U fleet fleet_test_<session>
DATABASE_URL=postgres://fleet:fleet@localhost:54320/fleet_test_<session> node node_modules/drizzle-kit/bin.cjs push --force
DATABASE_URL_TEST=postgres://fleet:fleet@postgres:5432/fleet_test_<session> DATABASE_WS_PROXY=localhost:5433/v1 npm run test:contract
```

Repousser le schéma à chaque changement de branche. Supprimer la base en fin de chantier (`docker compose -f docker-compose.test.yml exec postgres dropdb -U fleet fleet_test_<session>`), pas avec `test:db:down`, qui détruit le volume de tout le monde.

**Verrou de la base de test** : les suites intégration et contrat prennent un verrou en base (`pg_advisory_lock`, clé `hashtext('fleet-test:' || current_database())`) dans leur `globalSetup` (`tests/support/global-setup-db-lock.ts`) et le gardent jusqu'à la fin du passage. Deux passages sur la même base s'enchaînent, quelle que soit l'URL qui la désigne. Une base dédiée par session ne fait jamais attendre.

- Il remplace `lot-tools/db-lock.mjs` pour l'intégration et le contrat : plus besoin de l'envelopper. `db-lock.mjs` reste utile pour les e2e, que ce verrou ne couvre pas.
- Celui qui attend voit `[verrou base de test] en attente du verrou de test (pid N, fleet-test-lock <machine> pid <p> <worktree>, depuis …)`, rappelé chaque minute.
- Délai maximal : `FLEET_TEST_DB_LOCK_TIMEOUT_MS` (30 min par défaut). Au-delà, le passage échoue en nommant le détenteur et la commande pour libérer une session morte (`SELECT pg_terminate_backend(N);`).
- Un processus tué libère le verrou avec sa connexion : il n'y a aucun fichier périmé à nettoyer.
- En CI, une base par job : le verrou est pris aussitôt, sans effet. Cas : `tests/integration/test-db-lock.test.ts`.

- `DATABASE_WS_PROXY` (sans protocole) bascule `server/db.ts` sur le proxy en clair ; absent = Neon, inchangé.
- **Piège : `read ECONNRESET` au bout de 30 s sous rafale.** Le relais de ports de Docker Desktop (Windows) accepte parfois une connexion vers `localhost:<port wsproxy>` sans la transmettre au conteneur, puis la coupe au bout de 30 s. Le proxy ne voit rien passer, Postgres non plus. Ce cas est rare au repos, plus fréquent pendant qu'une autre session lance une campagne de contrats sur la même machine, le relais étant partagé par tous les conteneurs. Symptôme : un 503 de la garde de connexion (`login-lockout`) ou une 5xx sur la première requête qui ouvre une connexion. Avec le plafond `DATABASE_CONNECT_TIMEOUT_MS` (10 s par défaut), l'échec arrive en 10 s au lieu de 30. Il n'est pas masqué : relancer le fichier seul, et ne pas le classer comme une régression du code tant qu'il passe isolément. Reproduction sans l'application : boucle de connexions `Client` neon en rafale vers le même port (2 échecs sur 1 844, tous à 30 s). Voir `docs/analysis/LESSONS_LEARNED.md`, entrée du 2026-11-06 sur ce sujet.
- **Piège : timeouts de connexion sous rafale en local, ne pas relever le plafond.**
  - **Symptôme** : `timeout exceeded when trying to connect` (attente d'une place dans le pool) ou `Connection terminated due to connection timeout` (ouverture), sur les tests qui ouvrent beaucoup de connexions à la fois : `backup-production`, `login-lockout-db-store` (20 réservations en parallèle), `management-dashboard-service`.
  - **Mesure** (2026-11-06, wsproxy fm-cpw) : sur 20 connexions simultanées, 16 ou 17 s'ouvrent en moins de 0,8 s ; les 3 ou 4 autres restent muettes jusqu'à la coupure du relais à 30 s. Aucune valeur de plafond ne sauve une connexion muette :

    | `DATABASE_CONNECT_TIMEOUT_MS` | 3 fichiers ci-dessus, 3 passages | Effet |
    |---|---|---|
    | 10000 (défaut) | 3/3 verts | échec net en 10 s si une connexion est muette |
    | 30000 | 2 verts, 1 rouge `Test timed out in 30000ms` (40,8 s) | le plafond tombe en même temps que le `timeout: 30_000` du test, qui expire avant lui |
    | 0 | vert (1 passage) | attente jusqu'à la coupure du relais à 30 s |

  - **Conduite** : garder le défaut de 10 s. Ne pas le relever, cela ne fait que retarder l'échec. Relancer le fichier. Si l'échec se reproduit sur main pur et qu'une sonde de rafale (20 `pool.connect()` simultanés vers le wsproxy, `connectionTimeoutMillis: 0`, durée de chacun) montre des connexions coupées à 30 s, la cause est le relais, pas le code. La CI Linux, sans Docker Desktop, fait foi. Ne pas réduire la rafale dans ces tests : elle vérifie la concurrence (verrous consultatifs).
- L'hôte `postgres` de l'URL est résolu par wsproxy dans le réseau Compose, pas par Node : ne pas le remplacer par `localhost`.
- Les scripts `test:integration` et `test:contract` ne chargent pas `.env` : tout passe par l'environnement du shell.
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
