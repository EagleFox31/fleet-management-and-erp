# Journal — Base de données 1 (`db-1`)

Worktree : `../fm-db-1`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T14:06:00+01:00 — T-07a/T-07b/T-23c — Schéma unique du lot recette

- **Agent** : db-1 · **Branche** : `lot/db/T-07-schema` · **Commit** : voir `git log` (même commit)
- **Statut** : en cours (tsc à zéro, tests unitaires verts, intégration en cours)
- **Quoi** : toutes les tables et colonnes MUST et SHOULD du lot, additives et idempotentes.
- **Comment** : `shared/schema.ts`, `server/db/migrations/20261031_lot_recette.sql`, et la même liste d'ordres dans `LOT_RECETTE_SCHEMA_STATEMENTS` (`server/init-database.ts`, appliquée avant les index de performance). Verrou `pg_advisory_xact_lock` en tête. Test de dérive entre les deux listes. Reuse-first : patron `ALTER … IF NOT EXISTS` existant (Adapt).
- **Choix EXCLUDE (T-23c)** : constat db-2 (T-63) : des OT actifs sans `end_date` se chevauchent déjà (technicien 43/44/58, véhicule 44/54/58). Les deux contraintes `btree_gist` sont donc restreintes aux OT à `end_date` NON NULLE ; aucun OT modifié. Les OT ouverts sans fin restent couverts par le seul garde applicatif. Si `btree_gist` est refusée : avertissement, pas d'échec, contrôle applicatif seul.
- **Écarts** : `qc_*` (work_orders) et `received_at` (part_requirements) sont déclarés dans des tables Drizzle compagnes (`workOrderQuality`, `partRequirementReceipts`) en fin de `schema.ts`, car les ajouter à `workOrders`/`partRequirements` casse `server/storage.ts` et `part-requirements-service.ts` (types écrits à la main, fichiers interdits). `activity_logs` gagne `method`, `path`, `entity_ref` (contrat audit-logs). Types de document : `taxe` et `autre` ajoutés en plus des 9 pour l'ancien enum.
- **Comment tester (QA)** :
  - Prérequis : `DATABASE_URL_TEST`. Étapes : démarrer deux fois le serveur ; le second démarrage n'écrit rien.
  - Preuve : `node ../lot-tools/db-lock.mjs db-1 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/lot-recette-schema-idempotence.test.ts` ; unitaire : `node node_modules/vitest/vitest.mjs run tests/unit/server/lot-recette-schema-drift.test.ts`.
- **RAIDER** : R/A/I/D/R couverts (additif, idempotent, existant intact) ; scoped execution : sans objet.
- **Reste / risques** : T-26 (seed) à suivre ; fusion des tables compagnes plus tard.

## 2026-10-30T14:25:00+01:00 — T-26a/T-26b — Seed et reset de recette

- **Agent** : db-1 · **Branche** : `lot/db/T-26-seed-recette` (basée sur T-07) · **Commit** : voir `git log`
- **Statut** : fait pour le périmètre minimal (comptes, véhicules, reset) ; données transactionnelles (OT, demandes, pleins, factures, pointage) restent à écrire
- **Quoi** : `scripts/recette-seed.ts` (11 comptes `recette_*`, un par profil, deux techniciens et deux clients ; véhicules `RCT-001..012`, quatre au nom des clients) et `scripts/recette-reset.ts`.
- **Comment** : garde commune `scripts/lib/recette-guard.ts` (APP_ENV=recette ET hôte dans RECETTE_DB_HOST_ALLOW). Mots de passe lus dans `RECETTE_PASSWORD_<ROLE>` ou `RECETTE_PASSWORD`, 12 caractères minimum, jamais dans le dépôt. Reset : supprime seulement `recette_%` et `RCT-%` puis relance le seed, sans TRUNCATE (la base de dev est partagée avec les tests). Non exécutés contre aucune base.
- **Comment tester (QA)** : `node node_modules/vitest/vitest.mjs run tests/unit/server/recette-guard.test.ts` → refus hors recette, hôte hors liste.
- **RAIDER** : idempotent (ON CONFLICT), retroactive (reset borné à ce que le seed possède).
- **Reste / risques** : T-26b données transactionnelles ; mot de passe `driver` sans PIN.

## 2026-10-30T16:00:00+01:00 — T-26b — Données transactionnelles de recette

- **Agent** : db-1 · **Branche** : `lot/db/T-26-seed-recette`
- **Statut** : fait
- **Quoi** : `scripts/lib/recette-data.ts` (référentiel, OT, demandes de pièce, pleins, missions et factures, documents J+10/J+29/J+31, pointage, alertes), PIN chauffeur haché depuis `RECETTE_PIN`, reset borné.
- **Comment** : tout est marqué `RCT-*` / `recette_*` ; suppression ciblée dans l'ordre des clés étrangères, sans TRUNCATE ; `seedRecette` et `resetRecette` acceptent `closePool: false` pour les tests.
- **Comment tester (QA)** : `node ../lot-tools/db-lock.mjs db-1 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/recette-seed-reset.test.ts` : 1 test vert (comptages exacts, idempotence, véhicules hors RCT intacts, PIN bcrypt).
- **RAIDER** : idempotent, retroactive (existant intact), tsc sans erreur.
- **Reste / risques** : statut de facture `partial` déduit du schéma.
