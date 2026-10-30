# Journal — Base de données 2 (`db-2`)

Worktree : `../fm-db-2`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## T-42 : résolution des anomalies carburant
- **Agent** : db-2
- **Branche** : lot/db/T-42-anomalies-carburant (empilée sur lot/db/T-07-schema)
- **Commit** : voir `git log` de la branche
- **Statut** : prêt pour revue
- **Quoi** : `fuelAnomalyResolutionService` (resolve, get, justifiedKeys).
- **Comment** : upsert sur `anomaly_key` ; clé validée par `fuelAnomalyKeySchema` (400), plein inexistant refusé (404) ; `resolved_at` formaté en SQL.
- **Pourquoi** : une décision rejouée ne crée aucun doublon, la dernière l'emporte.
- **Comment tester (QA)** : `tests/integration/fuel-anomaly-resolution-service.test.ts` (2 passent) sous db-lock.
- **RAIDER** : R/A/I couverts (upsert), D : aucun contrat modifié, failure memory sans objet.
- **Reste/risques** : l'événement `fuel_anomaly_resolved` et la route sont à l'agent API.

## T-45 : service de pointage
- **Agent** : db-2
- **Branche** : lot/db/T-45-pointage (empilée sur lot/db/T-42, elle-même sur T-07)
- **Commit** : voir `git log` de la branche
- **Statut** : prêt pour revue
- **Quoi** : `timeTrackingService` (upsert, list, monthlyStats).
- **Comment** : upsert sur `(user_id, date)` (`uq_time_tracking_user_date`), `month`/`year` dérivés de la date, code validé contre TIME_CODES (400), totaux mensuels calculés à la lecture (`count(*)` groupé), `monthly_time_stats` non utilisée.
- **Pourquoi** : une saisie par personne et par jour, rejouable ; pas de cumul stocké qui dérive.
- **Comment tester (QA)** : `tests/integration/time-tracking-service.test.ts` (3 passent) sous db-lock.
- **RAIDER** : I : upsert ; D : contrat `time-tracking` inchangé ; R : aucune donnée existante touchée.
- **Reste/risques** : routes et garde de rôle à l'agent API.
