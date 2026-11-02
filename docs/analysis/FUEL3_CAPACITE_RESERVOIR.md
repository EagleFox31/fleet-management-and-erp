# FUEL3 : capacité des réservoirs (`vehicles.tank_capacity_l`)

Partie base de données de FUEL3 (règle d'anomalie carburant `tank-overflow`). Cadrage : `docs/plans/doc1-fuel3-cadrage.md`.

## Ce qui existe en base

| Objet | Définition | Rôle |
|---|---|---|
| Colonne `vehicles.tank_capacity_l` | `real`, nullable, sans défaut | Capacité totale des réservoirs en litres. `NULL` = inconnue. |
| Contrainte `vehicles_tank_capacity_l_positive` | `CHECK (tank_capacity_l IS NULL OR (tank_capacity_l > 0 AND tank_capacity_l < 'Infinity'::real))` | Refuse 0, négatif, `NaN` et `Infinity` (que `real` accepte sinon), quel que soit l'appelant. |

Créées de façon idempotente par `VEHICLE_TANK_CAPACITY_SQL` (`server/init-database.ts`), jumelle de
`server/db/migrations/20261102_vehicles_tank_capacity.sql` (même SQL, comparé par
`tests/unit/server/vehicles-tank-capacity-schema.test.ts`). Sous le verrou consultatif `fleetmaster_migrations`.

## Pourquoi ce partage base / serveur

- **En base** : `> 0`, invariant physique qui ne change pas et que tout appelant (route, script, SQL direct) doit respecter.
- **En saisie (Zod)** : bornes 1 à 2 000 L, `vehicleTankCapacitySchema` dans `shared/schema.ts`, message
  `VEHICLE_TANK_CAPACITY_MESSAGE`. La borne haute est une règle de saisie réglable, pas un invariant :
  la mettre en base forcerait une migration à chaque changement.
- **Reprise de l'existant** : tous les véhicules existants restent à `NULL`. La règle `tank-overflow` ne
  dit rien sans capacité (pas de faux positif) ; la saisie se fait progressivement depuis la fiche véhicule.

## Contrat pour le serveur

- Création (`insertVehicleSchema`) : `tankCapacityL` facultatif. Absent = non renseigné ; `null` ou `""` = vide ;
  sinon nombre entre 1 et 2 000.
- Modification : la route PATCH véhicule valide par type de colonne (`prepareColumnUpdate`), pas par Zod. Une
  valeur `<= 0` y arrive jusqu'à la base, qui la refuse avec le code `23514` et la contrainte
  `vehicles_tank_capacity_l_positive`. Le serveur doit valider avec `vehicleTankCapacitySchema` avant
  l'écriture, et traduire ce code en `AppError(400, VEHICLE_TANK_CAPACITY_MESSAGE)` s'il arrive quand même.

## Retour arrière

Voir l'en-tête de la migration : retirer le code d'abord, déployer, puis supprimer contrainte et colonne
(les capacités saisies sont perdues).
