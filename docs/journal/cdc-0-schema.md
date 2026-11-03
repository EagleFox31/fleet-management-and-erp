# Journal — Chantier CDC, lot DB-1 schéma (`cdc-0-schema`)

Worktree : `../fm-cdc-0-schema`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-31T19:35:02+01:00 — CDC-0 — Schéma unique des écarts #3, #7, #9, #10

- **Agent** : cdc-0-schema (fleet-db) · **Branche** : `lot/db/CDC-0-schema` · **Commit** : voir `git log` (même commit)
- **Statut** : fait ; intégration Vitest non jouée sur la base partagée (raison ci-dessous), preuve SQL faite sur un Postgres 17 jetable
- **Quoi** : tables et colonnes du chantier CDC, additives et idempotentes, sans aucune valeur semée.
  - #3 : index d'expression `parts_reference_key_idx` (`upper(btrim(reference))`), non unique.
  - #7 : `work_orders.due_date`, `work_orders.due_mileage` (CHECK `work_orders_due_mileage_check` >= 0), index partiel `work_orders_preventive_due_idx` ; reprise `due_date = start_date::date` des OT préventifs datés (0 ligne au second démarrage) ; table `workshop_labor_rates` vide.
  - #9 : table `import_batches` + index unique partiel `import_batches_applied_file_uidx` (un fichier appliqué une seule fois par type) ; `work_orders.origin`, `external_ref`, `import_fingerprint`, `import_batch_id` (FK `ON DELETE SET NULL`) avec index uniques partiels `work_orders_external_ref_uidx`, `work_orders_import_fingerprint_uidx` ; `vehicles.import_batch_id` ; index unique `vehicles_registration_key_uidx` sur l'immatriculation normalisée (lettres et chiffres, majuscules) des véhicules non supprimés, repli non unique `vehicles_registration_key_idx` + WARNING si des doublons existent.
  - #9 triggers : garde `fleetos.suppress_side_effects` en tête des 8 fonctions de trigger de `work-orders-alerts`, `work-orders-realtime`, `vehicle-alerts`, `maintenance-schedules-alerts`.
  - #10 : table `idempotency_keys` (unique `(user_id, key)`, expiration par défaut à 7 jours, index `idempotency_keys_expires_at_idx`).
- **Comment** : `server/db/migrations/20261101_cdc_ecarts.sql` et la même liste dans `CDC_SCHEMA_STATEMENTS` (`server/init-database.ts`), appliquée par `applyCdcSchema()` juste après `applyLotRecetteSchema()`, verrou `pg_advisory_xact_lock` en tête, un seul envoi = une transaction. Drizzle : tables `workshopLaborRates`, `importBatches`, `idempotencyKeys` ; tables compagnes `workOrderPlanning` et `vehicleImports` (modèle `workOrderQuality`) pour ne pas élargir `WorkOrder`/`Vehicle` ni `insertWorkOrderSchema`/`insertVehicleSchema`. Reuse-first : patron du lot recette (Adapt).
- **Pourquoi en base** : unicité d'un fichier d'import, d'une référence externe, d'une empreinte et d'une immatriculation normalisée tient quel que soit l'appelant et sous concurrence (un contrôle TypeScript « SELECT puis INSERT » laisse passer deux requêtes simultanées). La garde des triggers laisse la reprise d'historique couper alertes et événements temps réel dans sa seule transaction (`SET LOCAL`).
- **Écarts au plan** :
  - `applyBootstrapSqlFiles` ne rejoue que `work-orders-realtime-triggers.sql` ; les trois fichiers d'alertes ne sont rejoués nulle part et leurs triggers sont absents de la base de dev (contrôle en lecture seule). Garde ajoutée dans les quatre fichiers ; seule celle du temps réel prend effet au démarrage. Je n'ai pas ajouté les fichiers d'alertes au bootstrap : cela activerait des alertes aujourd'hui inexistantes (décision produit).
  - Défaut existant trouvé : `check_work_order_overdue()` affecte `CURRENT_DATE - start_date` (un `interval`, `start_date` étant un `timestamp`) à un `integer` ; si le fichier était appliqué, toute écriture sur un OT en retard échouerait. Non corrigé ici (hors périmètre), signalé.
  - Ajouts : CHECK sur `due_mileage`, index partiels sur `import_batch_id` (FK `SET NULL`), garde de la reprise `due_date` par la variable de suppression.
  - Pas de document dans `docs/` hors ce journal : fichiers hors périmètre du lot ; la logique est décrite ici et en tête de la migration.
- **Comment tester (QA)** :
  - Unitaire : `node node_modules/vitest/vitest.mjs run tests/unit/server/cdc-schema-drift.test.ts` → 10 passed (migration = init-database, colonnes Drizzle présentes en SQL, additif, garde en tête de chaque fonction de trigger).
  - Intégration (base de test distincte seulement) : `node ../lot-tools/db-lock.mjs cdc-0-schema -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/cdc-schema-idempotence.test.ts`. Non joué : `DATABASE_URL_TEST` = `DATABASE_URL` (base de dev partagée), interdit par le brief.
  - Preuve SQL jouée : Postgres 17.6 en conteneur jetable, schéma copié du dev par `pg_dump --schema-only` (lecture seule). Premier passage crée tout, second passage : catalogue et compteurs d'écriture identiques ; 9 index sur 9 ; cas refusés avec les noms de contrainte ci-dessous ; alertes et `fleet_events` à 0 sous garde, émis sans variable ; base avec doublons d'immatriculation : WARNING, repli non unique, second passage sans effet.
- **Contraintes à traduire par l'API (`AppError`)** : `import_batches_applied_file_uidx` (23505, « Ce fichier a déjà été importé ») ; `work_orders_external_ref_uidx` / `work_orders_import_fingerprint_uidx` (23505, ligne déjà importée) ; `vehicles_registration_key_uidx` (23505, « Immatriculation déjà utilisée », s'applique aussi à la création manuelle) ; `work_orders_due_mileage_check` (23514) ; `workshop_labor_rates_hourly_rate_ht_check` (23514), `workshop_labor_rates_effective_from_key` (23505) ; `idempotency_keys_user_id_key_key` (23505, course entre deux requêtes de même clé).
- **RAIDER** : R (patron réutilisé), A (vérifie `deleted_at` avant de s'en servir), I (second passage = zéro écriture, prouvé), D (791 tests unitaires verts, tsc 0, triggers inchangés sans la variable), R (aucune donnée existante modifiée hors reprise `due_date` des OT préventifs, aucun DROP). Scoped execution : sans objet.
- **Reste / risques** : intégration Vitest à jouer sur une base de test distincte ; doublons d'immatriculation sur la branche `recette` ou la production non vérifiés (repli prévu) ; correctif de `check_work_order_overdue()` à décider.

## 2026-10-31T21:40+01:00 — reprise après relecture de la PR #57

- **Quoi** : la reprise de `due_date` est bornée à un seul passage et ne notifie plus. L'index d'immatriculation devient non unique uniquement. La mesure d'idempotence se fait désormais sur une connexion dédiée.
- **Comment** :
  - `due_date` est créée dans un bloc DO. Ce bloc sort immédiatement si la colonne existe déjà, sinon il l'ajoute puis fait l'UPDATE de reprise. Pendant cet UPDATE, `trigger_work_orders_realtime_notify` est désactivé (seulement s'il est actif, `tgenabled = 'O'`), puis réactivé dans la même transaction. La garde `fleetos.suppress_side_effects` est posée en plus.
  - Le bloc des immatriculations ne crée plus que `vehicles_registration_key_idx` (non unique). Il compte les doublons et les signale par un WARNING.
  - Le test d'intégration mesure les écritures avec `pg_stat_get_xact_tuples_*`, dans la transaction de la connexion qui rejoue `CDC_SCHEMA_STATEMENTS`. Il prouve aussi qu'un OT préventif créé après le premier passage garde `due_date` à NULL.
- **Pourquoi** :
  - Sans borne, chaque démarrage réécrivait `due_date` sur tout OT préventif daté resté à NULL, y compris ceux créés après le premier passage.
  - Au premier démarrage, `applyBootstrapSqlFiles` passe après `applyCdcSchema` : la fonction temps réel n'a donc pas encore la garde, et la reprise aurait émis un `work_order_updated` par OT.
  - Un index unique sur l'immatriculation ferait échouer en 23505 `POST /api/vehicles` et l'activation. L'unicité reviendra au lot #9, par contrôle applicatif.
  - `pg_stat_force_next_flush()` ne vide que la session appelante, d'où la mesure sur une connexion dédiée.
- **Preuves** :
  - tsc global : 0 `error TS`.
  - Tests unitaires : 793 verts sur 66 fichiers, dont 12 tests de dérive.
  - Preuve SQL sur Postgres 17.6 jetable, schéma du dev copié par `pg_dump --schema-only` (lecture seule), avec le trigger temps réel d'origine sans garde :
    - premier passage : 0 notification, reprise faite, trigger de nouveau à `O` ;
    - second passage : 0 écriture, 0 notification, catalogue identique ; l'OT créé entre les deux passages et le `due_date` remis à NULL restent à NULL ;
    - un doublon d'immatriculation normalisée est accepté ;
    - sur une base qui contient déjà des doublons : WARNING, index non unique, second passage sans écriture.
  - Intégration Vitest non jouée, pour la même raison qu'avant : `DATABASE_URL_TEST` = `DATABASE_URL`.
- **Correction de l'entrée précédente** : la contrainte `vehicles_registration_key_uidx` n'existe plus. L'API n'a aucun 23505 d'immatriculation à traduire dans ce lot.
