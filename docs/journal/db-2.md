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
