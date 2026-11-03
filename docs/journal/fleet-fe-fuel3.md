# fleet-fe : anomalies carburant par règle

Quoi : colonne « Règle », valeur constatée et référence par règle (L ou km), data-testid par anomalyKey.
Comment : libellés dans `shared/constants/fuel-anomaly-rules.ts`, formatage pur dans `client/src/lib/fuel-anomaly-display.ts`, tableau `fuel-anomalies-table.tsx`.
Pourquoi : depuis #100 le serveur renvoie tank-overflow et odometer-regression ; le kilométrage s'affichait en litres et deux lignes d'un même plein étaient indiscernables.
Tester : `node node_modules/vitest/vitest.mjs run tests/unit/client/fuel-anomaly-display.test.ts`. Pas de spec e2e anomalies carburant existant.

## Suites FUEL3 : saisie de la capacité par la logistique (2026-11-02)

Quoi : panneau « véhicules sans capacité » sur l'écran des anomalies, saisie de `tankCapacityL` par véhicule (logistique, chef d'atelier, admin) ; seuil toléré affiché pour tank-overflow ; événement `vehicle_tank_capacity_changed` au lieu de `fuel_record_validated` avec un id de véhicule.
Comment : `GET /api/fuel-card/anomalies/summary` renvoie en plus `vehicles` (100 premiers, même filtre SQL que le compteur) ; `client/src/components/fuel/tank-capacity-panel.tsx` envoie `PATCH /api/vehicles/:id { tankCapacityL }` ; garde `canEditTankCapacity` (`VEHICLE_PATCH_ROLES`) ; `isVehiclePatcher` ajouté à la matrice RBAC unitaire.
Pourquoi : #105 ouvrait le PATCH à la logistique sans aucun écran pour l'utiliser ; un événement de plein portant un id de véhicule trompait tout consommateur de `data.id`.
Tester : `npm test` ; contrats `tests/contract/fuel-anomaly-rules.contract.test.ts` sur Postgres local (`DATABASE_URL_TEST=postgres://fleet:fleet@postgres:5432/fleet_test`, `DATABASE_WS_PROXY=localhost:5433/v1`).
