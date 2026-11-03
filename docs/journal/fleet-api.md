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

## 2026-11-02T18:00:00+01:00 — FUEL3 — La logistique saisit la capacité des réservoirs

- **Quoi** : `PATCH /api/vehicles/:id` s'ouvre à `logistics`, pour `tankCapacityL` seul ; tout autre corps de la logistique renvoie 403 lisible. Le changement de capacité émet `fuel_record_validated` (rôles carburant) et le catalogue invalide aussi `/api/fuel-card/anomalies` et `/summary`. Le compteur `vehiclesWithoutTankCapacity` exclut les véhicules `electric`.
- **Comment** : constantes `VEHICLE_EDIT_ROLES` / `VEHICLE_PATCH_ROLES` (`shared/constants/roles.ts`), garde `isVehiclePatcher`, helper pur `vehiclePatchRefusal` (`server/lib/vehicle-patch-guard.ts`) appelé en tête du handler existant ; aucune route ajoutée. Admin et chef d'atelier : droits inchangés.
- **Pourquoi** : décision de l'utilisateur (la logistique gère le carburant) ; la règle tank-overflow et le compteur changent avec la capacité, les autres profils doivent se resynchroniser (AGENTS.md §2).
- **Comment tester (QA)** : connecté en logistique, `PATCH /api/vehicles/:id` `{"tankCapacityL":90}` renvoie 200 ; `{"tankCapacityL":90,"notes":"x"}` ou `{"notes":"x"}` renvoie 403.
- **Preuve** : `tests/unit/server/vehicle-patch-guard.test.ts`, `tests/contract/fuel-anomaly-rules.contract.test.ts`, `tests/integration/fuel-anomaly-rules.test.ts`.
- **RAIDER** : Durable (rôles existants inchangés, test de non-régression), Idempotent (valeur identique : aucune diffusion), Reuse-first (événement existant). Écart : aucun écran de `lot-screens.ts` ne porte ce PATCH, à rattacher côté front.

## 2026-11-02T22:47:00+01:00 — PRT1/CAT2 — Routes des spécifications, variantes et pièces de panne

- **Quoi** : `GET/POST /api/parts/:id/specifications|variants`, `PATCH/DELETE .../:specId|:variantId` (lecture `isStaff`, écriture `isPartsCatalogManager`) ; `GET/POST /api/fault-catalog/:id/parts`, `PATCH/DELETE .../:linkId` (lecture `isStaff`, écriture `isWorkshopManager`). Panne archivée figée (409).
- **Comment** : routeurs existants `parts-catalog.routes.ts` et `fault-catalog.routes.ts`, deux services, migration idempotente (cascade des clés étrangères, dédoublonnage, index uniques) répliquée dans `init-database.ts` avec test de dérive.
- **Pourquoi** : routes absentes alors que l'écran les appelait ; l'écran `parts-database.tsx` est aligné.
- **Comment tester (QA)** : fiche pièce, onglets spécifications et variantes : ajout, modification, suppression ; doublon de code variante : message 409 lisible.
- **Preuve** : contrats `parts-catalog-crud` et `fault-catalog-lifecycle`, test unitaire `parts-catalog-children-schema`.
- **Suites de relecture** : FK pièce de `fault_catalog_parts` en RESTRICT (la panne reste en CASCADE), `deletePart` répond 409 « Pièce utilisée dans le catalogue de pannes » ; dédoublonnage limité aux lignes identiques (panne, pièce, quantité, optionnel), sinon index non posé et WARNING ; `idParam` borné à 2147483647 et `makeFailWith` partagés dans `server/lib/route-helpers.ts` ; unité vide convertie en null ; contraintes nommées comme drizzle ; rôle client 403 testé.
- **RAIDER** : Idempotent (migration rejouable), Durable (cascade explicite), Retroactive (dédoublonnage sans reset). Écarts : `/api/fault-catalog` GET/POST/DELETE de la fiche restent dans `routes.ts` ; `/api/parts/categories` sans route ; fault-catalog non audité (liste gelée) ; aucun événement WebSocket (référentiel relu à l'ouverture de la fiche).

## 2026-11-02T22:15:00+01:00 — FUEL — Mineurs des relectures #97/#100

- **Quoi** : (1) `odometer-regression` marque le plein fautif : sur un pic isolé (1000, 99999, 1100), c'est le pic qui est marqué, plus le plein suivant ; le contrat gagne `nextMileage` (optionnel, additif) et l'écran affiche « Précédent : …, suivant : … ». (2) Tolérance `tank-overflow` décimale : plus de `Math.trunc`. (3) Événement dédié `fuel_record_changed` pour un plein créé, modifié ou supprimé ; `fuel_record_validated` reste celui de la validation d'un bon. (4) `storage.updateVehicle` remonte les violations CHECK (23514) au lieu de les avaler : le filet de la route renvoie 400.
- **Comment** : CTE `drops` (LAG 1 et 2) dans `fuel-anomaly-resolution-service.ts` ; `toleranceSqlLiteral()` ; entrée du catalogue `realtime-events.ts` + cas dans `useRealTimeSync.ts` ; `isCheckViolation` / `pgConstraintOf` (`server/lib/pg-errors.ts`) dans le stockage et la route ; `console.error` du stockage migré vers `storageLog`.
- **Pourquoi** : un pic de saisie faisait marquer le plein correct qui suivait ; une tolérance 2,5 % serait devenue 2 % ; le nom `fuel_record_validated` ne disait pas « modifié » ; le filet 23514 ne se déclenchait jamais.
- **Comment tester (QA)** : saisir trois pleins 1000, 99999, 1100 km sur un véhicule : `/fuel/anomalies` marque celui à 99 999 km.
- **Preuve** : `tests/integration/fuel-anomaly-rules.test.ts` (pic, chute, tolérance, 23514), `tests/unit/client/fuel-anomaly-display.test.ts`, `tests/contract/fuel-anomaly-rules.contract.test.ts` (`fuel_record_changed`).
- **RAIDER** : Durable (cas existants inchangés, contrat additif) ; Retroactive : une décision déjà prise sur `odometer-regression:<plein suivant>` d'un pic reste en base mais ne s'affiche plus, l'anomalie réapparaît sous la clé du pic.

## 2026-11-03T01:45:00+01:00 — Dédoublonnage des six routes dupliquées de `server/routes.ts`

- **Quoi** : suppression des huit déclarations mortes des six routes déclarées deux fois (`GET /api/maintenance-schedules`, `GET /api/parts/:id/usage-history`, `GET /api/statistics/fleet-history`, `POST /api/check-all-maintenance`, `GET /api/warehouse/top-consumed-parts` et `stock-value-history`, ces deux dernières servies par `warehouse.routes.ts`). 164 lignes supprimées, aucune ajoutée. Liste gelée de `routes-hygiene.test.ts` vidée : toute nouvelle entrée est une régression.
- **Comment** : pour chaque route, vérification que la déclaration gardée est la première servie (Express sert la première ; `server/api/index.ts:104` monte les routeurs avant `registerRoutes`), contrat écrit sur le code d'origine et passé avant la suppression, puis suppression et re-passage. Table des lignes dans `docs/plans/dedoublonnage-routes.md`.
- **Pourquoi** : code mort qui a l'air vivant, cause de l'incident `PATCH /api/maintenance-schedules/:id` (LESSONS_LEARNED, 29 octobre 2026) ; dette gelée depuis dans AGENTS.md §9.
- **Comment tester (QA)** : aucun changement visible ; dashboards magasin, historique de flotte, plans de maintenance et vérification globale répondent comme avant.
- **Preuve** : `tests/contract/fleet-history`, `part-usage-history`, `check-all-maintenance` (nouveaux) ; `npm run check` 0 erreur ; unitaires 1033/1033 ; contrats 1063/1063 ; CI #120 8/8.
- **RAIDER** : Durable (comportement servi figé par contrat avant suppression, liste gelée en égalité stricte), Idempotent (rejouable), Retroactive (aucune donnée touchée). Écarts : le garde-fou d'hygiène ne détecte pas un routeur de `server/api/` qui masque `routes.ts` (documenté AGENTS.md §9, test à ajouter) ; `check-all-maintenance` laisse en base de test les échéances avancées et statuts réconciliés (seuls les OT créés sont supprimés).
