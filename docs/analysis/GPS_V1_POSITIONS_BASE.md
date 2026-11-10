# GPS V1 « position téléphone » : ce qui vit en base

Lot GPS-DB du cadrage `docs/plans/carte-chauffeur-gps-telephone.md` (§5). Drapeau `gps` coupé : aucune route ni
écran dans ce lot.

Source : `server/db/migrations/20261110_vehicle_positions_gps.sql`, jumelle de `VEHICLE_POSITIONS_GPS_SQL`
(`server/init-database.ts`), rejouée à chaque démarrage. Drizzle : `vehiclePositions`, colonnes A/B de `missions`
(`shared/schema.ts`).

## Décision du 2026-11-10 (utilisatrice)

Pas de table de consentement ni de consentement bloquant : les chauffeurs savent que les camions sont suivis, le
QHSE communique, TAY fournit les téléphones. La position est relevée pendant la fenêtre de mission
(`in_progress` → `delivered`). Rétention : 30 jours, en configuration.

## Objets

| Objet | Rôle |
|---|---|
| `vehicle_positions` | Points de toutes les sources (`phone`, `tracker`). `recorded_at` = heure du relevé (appareil), `received_at` = arrivée au serveur (défaut `now()`). `suspect` = point marqué par le serveur (vitesse implicite > 200 km/h, §6), jamais supprimé. |
| `missions.pickup_lat/lng/hub_code`, `delivery_lat/lng/hub_code` | Points A et B, facultatifs. Un code de hub non NULL = point pris dans la liste des hubs ; NULL avec coordonnées = point posé sur la carte. |
| `purge_vehicle_positions(jours)` | Supprime les points relevés avant `now() - jours`, renvoie le nombre supprimé. |
| `server/lib/gps-retention.ts` | Lit `GPS_POSITION_RETENTION_DAYS` (1 à 3650, sinon 30) et appelle la fonction. |

Index : `(mission_id, recorded_at)` pour le tracé d'une mission, `(vehicle_id, recorded_at DESC)` pour la dernière
position d'un véhicule (`DISTINCT ON (vehicle_id)`).

## Invariants tenus par la base

| Contrainte (nom renvoyé, code 23514 sauf mention) | Refuse | Message attendu côté serveur (`AppError` 400) |
|---|---|---|
| `vehicle_positions_coords_check` | latitude hors [-90, 90] ou longitude hors [-180, 180] | « Position GPS invalide. » |
| `vehicle_positions_measures_check` | précision ou vitesse négative, cap hors [0, 360[ | « Mesure GPS invalide (précision, vitesse ou cap). » |
| `vehicle_positions_phone_check` | point téléphone sans mission, sans auteur ou sans identifiant de point | « Position téléphone hors mission. » |
| `vehicle_positions_tracker_check` | point balise sans boîtier | erreur interne (aucune saisie utilisateur) |
| `vehicle_positions_source_check` | source autre que `phone` / `tracker` | erreur interne |
| `vehicle_positions_client_point_unique` (23505) | même point rejoué (source, auteur, identifiant client) | aucun : insérer par `ON CONFLICT ON CONSTRAINT vehicle_positions_client_point_unique DO NOTHING`, le rejeu hors ligne est un succès |
| `missions_pickup_geo_check`, `missions_delivery_geo_check` | latitude sans longitude (ou l'inverse), coordonnées hors bornes, code de hub vide ou sans coordonnées | « Point de départ (ou d'arrivée) incomplet. » |
| `purge_vehicle_positions` (22023) | durée NULL ou < 1 | erreur interne : la durée vient de la configuration, jamais d'un utilisateur |

Pourquoi en base : un point refusé ici l'est quel que soit l'appelant (route téléphone, futur récepteur de balise,
import), et le rejeu hors ligne ne peut pas créer de doublon même sous course.

## Clés étrangères

| Colonne | Cible | ON DELETE | Raison |
|---|---|---|---|
| `vehicle_id` | `vehicles` | CASCADE | Trace éphémère ; un véhicule qui a des positions n'est pas supprimé physiquement mais en suppression douce, `vehicle_positions` étant classée « source d'action » (`server/services/vehicle-lifecycle-sources.ts`) |
| `mission_id` | `missions` | CASCADE | Le plan prévoyait SET NULL, incompatible avec `vehicle_positions_phone_check` (un point téléphone exige sa mission) : la suppression d'une mission échouerait |
| `driver_id` | `drivers` | SET NULL | Le point reste attaché au véhicule et à la mission |
| `submitted_by` | `users` | CASCADE | Point téléphone de l'utilisateur supprimé, sans valeur hors de sa mission |

`device_id` n'a pas de clé étrangère : `telemetry_devices` n'existe pas encore ; le lot balises la posera.

## Purge

- Une suppression par passage, sur `recorded_at`. Volume estimé : 30 camions × 1 point / 30 s en mission ≈ 360 000
  lignes sur 30 jours ; la purge quotidienne parcourt la table sans index dédié, acceptable à ce volume.
- Idempotente : un second passage le même jour renvoie 0 et n'attribue aucun identifiant de transaction.
- La planification (une fois par jour) revient au lot API. Le serveur doit aussi refuser un point plus vieux que la
  rétention : sinon un rejeu après purge le réinsère.

## Idempotence et données existantes

- Second démarrage : aucune écriture, catalogue compris (colonnes ajoutées seulement si absentes, fonction recréée
  seulement si son corps diffère). Prouvé par `tests/integration/vehicle-positions-gps.test.ts`.
- Missions existantes : colonnes à NULL, aucune reprise. Une base déjà poussée par `drizzle-kit push` est
  réconciliée (contraintes posées `NOT VALID` puis validées) ; une ligne hors règle laisse la contrainte non
  validée et un avertissement, relu par `reportCdcConstraintGaps` (`CDC_RECONCILED_CONSTRAINTS`).

## Retour arrière

Retirer `VEHICLE_POSITIONS_GPS_SQL` et son appel, la migration et les déclarations Drizzle, déployer, puis jouer le
bloc `DROP` donné en tête de la migration.
