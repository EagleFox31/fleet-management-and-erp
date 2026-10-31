# Journal — Backend 2 (`be-2`)

Worktree : `../fm-be-2`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T14:00:00+01:00 — T-23a — Règle de double affectation

- **Agent** : be-2 · **Branche** : `lot/be/T-23a-double-affectation` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : un technicien ou un véhicule ne peut plus être sur deux OT actifs qui se chevauchent ; la règle est prête, le branchement sur les routes OT reste T-23b.
- **Comment** : `server/services/work-order-booking.ts`. `findBookingConflicts(candidate, existing[])` (pure, réutilise `bookingsOverlap`, `[from, to)`, fin absente = ouvert, exclusion de soi par `id`, statuts `BOOKING_ACTIVE_STATUSES`), `loadActiveOrders(executor, technicianId, vehicleId)` (colonnes `start_date`/`end_date`, filtré en base), `bookingGuard(candidate, deps?)` qui lève `BookingConflictError` (409, code `CONFLICT`). Build (règle métier propre, rien à adopter).
- **Pourquoi** : P-08 / PR-10, plan 04-backend T-23a.
- **API pour T-23b (api-2)** : `await bookingGuard({ id, technicianId, vehicleId, from: startDate, to: endDate }, { executor: tx })` avec le corps fusionné à la ligne existante, avant l'écriture. L'erreur porte `conflicts` et `details: { conflicts }`. `AppError.details` (T-08) n'est pas encore poussé (seule `origin/lot/sol/T-02-contrats` existe) : le gestionnaire central ne renvoie donc pas encore `conflicts` ; en attendant, l'intercepteur répond avec `conflictResponseBody(err, req.requestId)` (conforme à `bookingConflictResponseSchema`). Un OT sans `startDate` n'occupe aucun créneau.
- **Comment tester (QA)** :
  - Prérequis : aucun (unitaire).
  - Preuve automatisée : `node node_modules/vitest/vitest.mjs run --reporter=dot tests/unit/server/work-order-booking.test.ts` → `12 passed`. `tsc --noEmit` : 0 erreur.
- **RAIDER** : R/A règle pure indépendante du routeur ; I lecture seule ; D aucun fichier existant modifié ; E contrat figé respecté. Failure memory : sans objet.
- **Reste / risques** : course lecture-avant-écriture actée en ADR ; branchement T-23b ; `details` dépend de T-08.
## 2026-10-30T15:00:00+01:00 — T-43 — Service d'incidents

- **Agent** : be-2 · **Branche** : `lot/be/T-43-incidents` (sur T-07) · **Commit** : voir `git log`
- **Statut** : fait côté service ; routeur, contrat HTTP et temps réel à deux comptes pour l'API
- **Quoi** : un chauffeur peut déclarer une panne sur son véhicule ; le chef d'atelier et l'admin sont alertés et reçoivent `incident_reported`.
- **Comment** : `server/services/incident-service.ts` : `incidentScopeError` (règle pure : chauffeur limité aux véhicules de ses affectations actives `pending|accepted|in_progress` via `assignments` + `drivers.user_id`, client 403, personnel libre), `createIncident(actor, body)` (transaction, `created_by`/`updated_by`, puis alerte dédupliquée `incident_reported:<id>` par `storage.createAlert` aux rôles `workshop_manager` et `admin`, puis `broadcastUpdate("incident_reported", ..., scope roles)` après commit), `listIncidents(actor, { status })` (un chauffeur ne relit que ses déclarations). `alert-service.ts` non modifié. Écart au plan : l'alerte part après le commit et non dans la même transaction (`storage.createAlert` n'est pas transactionnel) ; la dédup rend un retry sans doublon et un échec d'alerte n'annule pas la déclaration.
- **Pourquoi** : P-22 / R-13, plan 04-backend T-43.
- **API pour l'API (`server/api/incidents.routes.ts`, drapeau `incidents`)** : `POST` → `createIncident(req.user, createIncidentRequestSchema.parse(body))` ; `GET` → `listIncidents(req.user, incidentsQuerySchema.parse(query))`. Les `AppError` 401/403 sortent telles quelles.
- **Comment tester (QA)** : preuve automatisée `node node_modules/vitest/vitest.mjs run --reporter=dot tests/unit/server/incident-service.test.ts` → 6 passed. Contrat HTTP et trame WS à deux comptes (chauffeur déclare, chef d'atelier reçoit) : après le routeur.
- **RAIDER** : R/A règle pure et dépendances injectées ; I alerte dédupliquée ; D aucun fichier existant modifié ; E audit 4 colonnes (createdAt/updatedAt posés), erreurs métier lisibles. Failure memory : sans objet.
- **Reste / risques** : intégration non écrite (base de test occupée) ; la table `incidents` n'a pas de `idx` testé ici.
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
## 2026-10-30T17:12:46+01:00 — T-17a — Alertes d'échéance des documents véhicule typés
- **Agent** : be-2 · **Branche** : `lot/api/T-17b-should-notify` (PR #41, fusionne T-16) · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : alerte pour tout document véhicule dont l'échéance tombe dans les `alert_days` de son type (30 par défaut, J+0 à J+30 inclus) ou est déjà échue.
- **Comment** : règle pure `server/services/document-expiry-rule.ts` (jours calendaires UTC, horloge injectée, clé `doc_expiry:<statut>:<id>:<échéance>`). `AlertService.checkTypedDocumentExpiryAlerts` joint `vehicle_documents` aux types (actifs, `validity_months` renseigné), émet via `createAlertIfNotExists` avec `topic: documents` (donc filtré par `shouldNotify`) vers les rôles maintenance ; appelé par `runAllAlertChecks` donc par le scheduler existant. `createAlertIfNotExists` gagne `dedupeKey` optionnel (alerte lue ou non, jamais recréée ; nouvelle échéance = nouvelle clé) et un échec sur un destinataire ne prive plus les autres. Événement `alert_created` (scope utilisateur) déjà émis par cette fonction. Build : Adapt.
- **Pourquoi** : P-05 / R-12, éviter les documents échus sans préavis ; une seule modification de `alert-service.ts` pour le lot (PR-08).
- **Comment tester (QA)** :
  - Prérequis : un chef d'atelier, un véhicule, un document `visite_technique` avec échéance à J+30.
  - Étapes : 1. lancer le cycle d'alertes (scheduler). 2. le relancer. 3. marquer l'alerte lue et relancer.
  - Attendu : une seule alerte thème `documents` ; rien à J+31 ni pour un type sans échéance (`taxe`) ; aucun doublon ; un utilisateur ayant coupé `documents` ne la reçoit pas.
  - Preuve automatisée : `tests/unit/server/document-expiry-rule.test.ts` (J+29, J+30, J+31, échu) ; `node ../lot-tools/db-lock.mjs be-2 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/document-expiry-alerts.test.ts` → 2 passed ; `tsc --noEmit` 0 erreur.
- **RAIDER** : couvert idempotence (clé par document et échéance), non-régression (chemin sans `dedupeKey` inchangé), retroactif (documents existants pris au prochain cycle) ; sans objet : migration (colonnes existantes). Note : l'intégration est sensible aux nettoyages globaux d'autres suites sur la base partagée ; les comptes du test sont donc hors préfixe TEST_.
