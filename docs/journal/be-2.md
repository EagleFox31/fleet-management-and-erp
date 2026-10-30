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

## 2026-10-30T14:35:00+01:00 — T-19b — Sauvegarde planifiée, verrou et alerte d'échec

- **Agent** : be-2 · **Branche** : `lot/be/T-19b-planification` (sur T-07 et T-19a) · **Commit** : voir `git log`
- **Statut** : fait ; test d'intégration écrit, exécution en attente du verrou base de test (voir Reste)
- **Quoi** : la sauvegarde quotidienne démarre au lancement du serveur puis à chaque tick de 5 min, seulement si la dernière réussite a plus de 24 h ; un échec crée une alerte critique pour chaque admin et l'événement `backup_failed`.
- **Comment** : `server/jobs/backup-production.ts` : dépôt Drizzle sur `backup_runs` (nom du fichier = colonne `location` ; pas de colonne durée, elle se calcule), verrou `pg_try_advisory_lock(hashtext('backup'))` sur une connexion dédiée de `listenerPool` (chaîne directe), `notifyBackupFailure` (`storage.createAlert` par admin, `dedupe_key=backup_failed:<id>`, puis `alert_created` et `backup_failed` scope rôle admin), `backupTick` avec repos de 6 h après un échec (pas d'alerte toutes les 5 min). `server/scheduler.ts` (sans propriétaire, décision de l'orchestrateur) : appel de `backupTick`, et tous les `console.*` migrés vers `moduleLogger("scheduler")`. Interrupteur `BACKUP_ENABLED=0`. Alerte : `alert-service.ts` non modifié ; ses fonctions publiques ne couvrent pas ce cas, j'utilise `storage.createAlert` (type `maintenance`, l'enum n'a pas de type dédié).
- **Pourquoi** : P-06, T-19b ; cadence rattrapable (instance autoscale endormie).
- **Comment tester (QA)** :
  - Prérequis : `BACKUP_KEY` (64 hex), `pg_dump` installé (`PG_DUMP_BIN`, `PG_SERVER_MAJOR`), compte admin.
  - Étapes : 1. démarrer le serveur 2. attendre 2 s 3. lire `backup_runs`. Sans `pg_dump` : ligne `failed` code `PG_DUMP_MISSING`, alerte admin « Sauvegarde de la base en échec ».
  - Attendu : une ligne `success` avec checksum, un fichier `backups/*.dump.enc` ; un second démarrage n'en crée pas.
  - Preuve automatisée : `node node_modules/vitest/vitest.mjs run --reporter=dot tests/unit/server/backup.test.ts` → 13 passed ; intégration : `tests/integration/backup-production.test.ts` (verrou à deux verrous, dépôt).
- **RAIDER** : R/A adaptateurs derrière interfaces ; I verrou + index unique `uq_backup_runs_single_running` + repos après échec ; D scheduler : même comportement des alertes, logs migrés et non supprimés ; E secrets absents des logs. Failure memory : sans objet.
- **Reste / risques** : exécution de l'intégration en attente du verrou `api-1` ; temps réel à deux rôles (admin reçoit `backup_failed`) à jouer avec le serveur de recette ; stockage local éphémère en autoscale (limite déjà actée).
