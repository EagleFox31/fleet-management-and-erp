# Journal — fleet-api (routes, services, temps réel)

Règles : `docs/journal/README.md`.

## 2026-11-02T14:35:00+01:00 — FUEL3 — Règles de détection, compteur, capacité au PATCH véhicule

- **Agent** : fleet-api · **Branche** : `lot/api/fuel3-regles` (depuis `lot/db/fuel3-capacite`) · **Commit** : voir `git log`
- **Statut** : fait (partie serveur ; écran à fleet-fe)
- **Quoi** :
  - deux règles d'anomalie carburant, `tank-overflow` (quantité > capacité x 1,05) et `odometer-regression` (kilométrage < plein précédent du véhicule), clé `<règle>:<id du plein>` ;
  - `GET /api/fuel-card/anomalies/summary` : `{ vehiclesWithoutTankCapacity }` ;
  - `PATCH /api/vehicles/:id` : `tankCapacityL` validé (0, négatif, texte, > 2 000 : 400 lisible) ;
  - diffusion temps réel à la création, modification et suppression d'un plein.
- **Comment** :
  - `server/services/fuel-anomaly-resolution-service.ts` : CTE SQL calculée à la lecture comme `consumption-gap`, `LAG` sur `(date, id)` pour le kilométrage précédent, comparaison en `numeric` (pas d'arrondi float4), tolérance `TANK_OVERFLOW_TOLERANCE_PERCENT = 5` ; pleins sans véhicule, sans date (odomètre) et électriques ignorés ; kilométrage nul ou 0 = absent ;
  - `shared/contracts/fuel-anomalies.ts` : énumération élargie, champs facultatifs `mileage`, `previousMileage`, `tankCapacityL`, schéma du compteur ;
  - `server/routes.ts` (gelé, retouche minimale) : validation par `vehicleTankCapacitySchema` avant `prepareColumnUpdate`, filet `23514`, 3 appels à `server/lib/fuel-record-realtime.ts` ; `console.error` des deux routes touchées migrés vers `moduleLogger` ;
  - `server/lib/fuel-record-realtime.ts` : réutilise l'événement existant `fuel_record_validated` (invalide `/api/fuel-card`, donc les anomalies).
- **Pourquoi** : cadrage FUEL3 ; compteur en route séparée pour ne pas casser les consommateurs du tableau renvoyé par la liste.
- **Comment tester (QA)** :
  - Prérequis : `.env` avec `DATABASE_URL_TEST`, sous `db-lock`.
  - Étapes : 1. donner 100 L à un véhicule ; 2. saisir un plein de 106 L puis de 105 L ; 3. saisir un plein à 900 km après un plein à 1 000 km ; 4. `GET /api/fuel-card/anomalies` ; 5. `PATCH /api/vehicles/:id` avec `{"tankCapacityL":0}`.
  - Attendu : seul le plein de 106 L est signalé ; la régression est signalée ; le PATCH renvoie 400 avec le message de capacité.
  - Preuve automatisée : `tests/integration/fuel-anomaly-rules.test.ts`, `tests/contract/fuel-anomaly-rules.contract.test.ts`.
- **RAIDER** : couvert : Durable (champs facultatifs, route existante inchangée), Idempotent (lecture seule), Reuse-first (événement existant), erreurs par `AppError`. Ne s'applique pas : migration (portée par `fleet-db`).
- **Reste / risques** :
  - `consumption-gap` ne tient pas compte de `full_tank` et exige `debit_amount > 0` : les pleins saisis par `POST /api/fuel-records` ne sont jamais couverts par lui ;
  - le PATCH véhicule reste réservé à `admin` et `workshop_manager` : la logistique ne peut pas renseigner la capacité (écart éventuel avec l'écran) ;
  - `storage.updateVehicle` avale les erreurs base : le filet `23514` ne se déclenche pas en pratique, la validation amont suffit ;
  - événement dédié `fuel_record_changed` à déclarer dans `shared/contracts/realtime-events.ts` et `useRealTimeSync.ts` (autre session) ;
  - agrégat candidat pour `fleet-db` : le compteur et les règles pourraient devenir une vue SQL.
