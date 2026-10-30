# Journal — Backend 2 (`be-2`)

Worktree : `../fm-be-2`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T14:40:00+01:00 — T-19a — Sauvegarde chiffrée (noyau)

- **Agent** : be-2 · **Branche** : `lot/be/T-19a-sauvegardes` · **Commit** : voir `git log`
- **Statut** : en cours (noyau fait ; adaptateurs base et scheduler en attente de db-1 / T-07)
- **Quoi** : orchestration de sauvegarde quotidienne testable : pg_dump, chiffrement AES-256-GCM, stockage local hors `uploads/`, verrou, rattrapage, purge 12 mois, alerte d'échec.
- **Comment** : `server/jobs/backup.ts` (`runBackup`, `runDailyBackup`, `isBackupDue`, `retentionCutoff`, dépendances injectées), `server/lib/backup/{encrypt,storage,dump}.ts`. Clé `BACKUP_KEY` (32 octets hex/base64), jamais journalisée ; URL passée par `PGDATABASE` du processus fils, pas en argument. Version : `PG_SERVER_MAJOR` + `PG_DUMP_BIN`. Build (node:crypto, aucune dépendance).
- **Pourquoi** : P-06 / PR-09, plan 04-backend T-19a/b.
- **Comment tester (QA)** : `node node_modules/vitest/vitest.mjs run --reporter=dot tests/unit/server/backup.test.ts` → `13 passed` ; `tsc --noEmit` 0 erreur. Aucun pg_dump exécuté.
- **RAIDER** : R/A stockage et dépôt derrière interfaces ; I verrou + rattrapage sans rafale ; D aucun fichier existant modifié ; E secrets non journalisés, erreurs par code. Failure memory : sans objet.
- **Reste / risques** : (1) dépôt Drizzle `BackupRunRepository` sur `backup_runs` : attend `origin/lot/db/T-07-schema` (absent) ; (2) verrou `pg_try_advisory_lock(hashtext('backup'))` sur connexion dédiée (chaîne directe) ; (3) câblage `scheduler.ts` + `notifyFailure` (alert-service + `broadcastUpdate("backup_failed", { id })`) ; (4) pg_dump absent de cette machine, version à vérifier en T-27.
