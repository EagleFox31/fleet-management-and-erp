# CI et Postgres local pour les suites intégration et contrat

Date : 2026-11-02. Branche : `fix/workflow-id-400`.

## Constat

Les suites `test:integration` et `test:contract` sont sérialisées (un worker, pas de parallélisme de
fichiers) et chaque requête traverse l'Atlantique vers Neon. La latence réseau domine : les tests
eux-mêmes sont courts.

## Mesures (machine de développement, Windows 11, Docker Desktop)

| Suite | Neon (`DATABASE_URL_TEST`) | Postgres local (wsproxy) | Gain |
|---|---|---|---|
| Contrat (86 fichiers, 910 tests) | **5 721 s** (95 min, 894/910 : 16 échecs sur 5 fichiers, connexions et sessions concurrentes sur la même base) | **202 s** (909/910) | **× 28** |
| Intégration (164 tests) | non mesuré | **53 s** (161/164) | — |

Résultats hors vert, à ne pas confondre avec le montage :

- `labor-catalog` (contrat, créations simultanées du même code) : `[201, 500]` au lieu de
  `[201, 400]`. Défaut produit révélé par la latence basse : le contrôle « le code existe déjà »
  précédait l'`INSERT` et la contrainte UNIQUE tranchait en 500. Corrigé dans
  `server/services/work-order-items-service.ts` (violation 23505 → refus métier 400), 3/3 verts.
- `management-dashboard-service` ×2 (intégration) : flaky connu, verts isolés.
- `part-requirement-received-by` (intégration) : `Saisissez un montant HT ou TTC supérieur à 0`
  (`three-way-matching-service.ts`, contrôle ajouté le 2026-11-01 par c3f3260, test du 2026-10-30).
  Échoue aussi sur Neon (vérifié le 2026-11-02) : régression produit sur `main`, indépendante du
  montage ; non corrigée ici.

## Montage

- `docker-compose.test.yml` : `postgres:17.6-alpine` (tmpfs, port 54320) + `ghcr.io/neondatabase/wsproxy`
  (port 5433, épinglé par digest : dépôt sans tag). Le driver `@neondatabase/serverless` parle WebSocket,
  le proxy fait le pont vers un Postgres standard.
- `server/db.ts` : `DATABASE_WS_PROXY` bascule `neonConfig` (proxy en clair, `pipelineConnect=false`
  pour SCRAM). Absent = Neon, inchangé.
- `package.json` : `test:db:up` / `test:db:schema` / `test:db:down`. Le schéma est posé par
  `drizzle-kit push` : `initializeDatabase()` n'est pas « from scratch »
  (voir `docs/analysis/LESSONS_LEARNED.md`, entrée du 2026-11-02).
- `.github/workflows/ci.yml` : jobs `typecheck`, `unit`, `integration`, `contract` (4 shards vitest,
  une base par shard), gardés par l'analyse d'impact AppFactory (`.github/appfactory-impact.json`).

Procédure locale : `tests/README.md`, section « Postgres local ».

## Limites connues

- La base Neon de test porte 6 tables hors `shared/schema.ts` (`destination_rates`, `idempotency_keys`,
  `import_batches`, `operation_costs`…) : 61 tables / 852 colonnes contre 55 / 776 en local. Les
  triggers sont identiques (7/7). Un test qui dépend d'une de ces tables échouera en local et en CI :
  c'est le signal qu'elle doit entrer dans le schéma.
- Le proxy est joint en clair (`ws:`) : réservé à la machine locale et au réseau du job CI.
- Les shards CI ne sont pas équilibrés par durée (découpage par fichier, vitest `--shard`).

## Suite possible

- Équilibrer les shards (durée par fichier) si un shard domine.
- Basculer la base Neon de test vers le schéma Drizzle seul, ou intégrer les 6 tables manquantes.
