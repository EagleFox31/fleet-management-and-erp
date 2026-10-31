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

## 2026-10-30T14:30:00+01:00 — T-40 — Lectures agrégées (coût véhicule, mouvements de pneus, factures en attente)

- **Agent** : db-2 · **Branche** : `lot/db/T-40-lectures-agregees` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : `aggregateReadsService` : coût par véhicule, mouvements de pneus (montage, démontage, rotation, inspection), factures en attente par client.
- **Comment** : `server/services/aggregate-reads-service.ts`, SQL en lecture seule, une sous-requête par source de coût, dates en `to_char` pour éviter le décalage de fuseau.
- **Pourquoi** : P-14, P-15, P-21, plan 03 T-40.
- **Comment tester (QA)** :
  - Prérequis : `DATABASE_URL_TEST`.
  - Attendu : coût 14 000 + 5 500 + 124 200 = 143 700 sur jeu connu ; 4 mouvements ordonnés ; 2 missions sans facture active pour le client du test.
  - Preuve automatisée : `node ../lot-tools/db-lock.mjs db-2 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/aggregate-reads-service.test.ts` → 3 passed.
- **RAIDER** : couvert : lecture seule, contrats inchangés, tests sous verrou. Ne s'applique pas : migration.
- **Reste / risques** : `missions` n'a aucun tarif, donc `amount` des factures en attente vaut 0 (écart à trancher par le produit) ; le plan parlait de `client_invoices` non soldées, le contrat dit « opérations non facturées » (contrat suivi) ; pas de pagination par clé (limite 500) ; routes HTTP non branchées.
