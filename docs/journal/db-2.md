# Journal — Base de données 2 (`db-2`)

Worktree : `../fm-db-2`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T13:55:00+01:00 — T-63 / T-64 — Contrôles de données et plan des branches de test

- **Agent** : db-2 · **Branche** : `lot/db/T-63-controles` · **Commit** : voir `git log`
- **Statut** : fait (T-64 : plan seulement, aucune commande Neon)
- **Quoi** : rapport `docs/analysis/controles-donnees-lot.md` : version Postgres, `btree_gist`, volumes, données incompatibles avec les futures contraintes, plan de branches de test et coût de rétention.
- **Comment** : script Node temporaire hors dépôt, transaction `READ ONLY` puis `ROLLBACK`, sur `DATABASE_URL` et `DATABASE_URL_TEST`. Aucun secret journalisé.
- **Pourquoi** : plan 03, T-63 et T-64, avant T-07a et T-23b.
- **Comment tester (QA)** :
  - Prérequis : `.env` avec `DATABASE_URL`.
  - Étapes : 1. lire le §1 du rapport ; 2. rejouer les requêtes du §5 en lecture seule.
  - Attendu : PostgreSQL 17.x, `btree_gist` disponible, 3 paires d'OT actifs qui se chevauchent par technicien et par véhicule.
  - Preuve automatisée : sans objet (document d'analyse).
- **RAIDER** : couvert : Idempotent (lecture seule, rejouable), Retroactive (aucune donnée touchée). Ne s'applique pas : tests de non-régression (aucun code).
- **Reste / risques** : `DATABASE_URL_TEST` est identique à `DATABASE_URL` (même base) ; la règle « fin nulle = infini » de l'EXCLUDE entrerait en conflit avec les données réelles (voir §2, §3).

## 2026-10-30T14:20:00+01:00 — T-25 — Service SQL des KPI direction

- **Agent** : db-2 · **Branche** : `lot/db/T-25-kpi` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : `kpiService` : incidents par mois, conformité préventive (`null` sans échéance), coût moyen par intervention (pièces agrégées à part).
- **Comment** : `server/services/kpi-service.ts`, SQL agrégé en lecture seule, contrats `shared/contracts/kpi.ts` inchangés. Les incidents sont les OT correctifs non annulés (définition du plan 03 T-25) : aucune dépendance à la table `incidents` de db-1.
- **Pourquoi** : P-09 / P-10, plan 03 T-25.
- **Comment tester (QA)** :
  - Prérequis : `DATABASE_URL_TEST`.
  - Étapes : lancer le test ci-dessous (jeu connu de 2019 : 7 OT, 2 lignes de pièces).
  - Attendu : mars 2019 = 2 incidents, avril = 1 ; 1 préventif à temps sur 3 ; coût moyen 12 667 (38 000 sur 3).
  - Preuve automatisée : `node ../lot-tools/db-lock.mjs db-2 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/kpi-service.test.ts` → 4 passed.
- **RAIDER** : couvert : Idempotent (lecture seule), Durable (aucune table ni contrat modifié), tests sous verrou. Ne s'applique pas : migration.
- **Reste / risques** : « à temps » = fin au plus tard le jour prévu + durée ; définition à valider par le produit. Route HTTP non branchée (API).
