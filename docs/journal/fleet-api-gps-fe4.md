# Journal fleet-api - lot GPS-FE-4

## 2026-11-10 - Carte Direction : plus de position ni de statut inventés
- **Statut** : fait, PR brouillon
- **Quoi** : `aggregateCorridorFleet` ne fabrique plus de coordonnée, de progression, de vitesse, de consommation ni de trajet par défaut ; le statut vient de la mission réelle.
- **Comment** : fonction pure `buildCorridorVehicle` (`server/services/corridor-fleet.ts`) ; contrat `LiveCorridorVehicle` avec `positionSource` et champs de position optionnels ; carte client qui ne trace que les positions réelles.
- **Pourquoi** : cadrage `carte-chauffeur-gps-telephone` (risque « position fictive affichée comme réelle »), à corriger avant de remonter la carte direction.
- **Preuve** : unitaire `corridor-fleet`, contrat `management-dashboard-kpis` (rouge sur l'ancien service, vert ensuite, Postgres local).
- **RAIDER** : couvert non-régression (champs rendus optionnels, consommateur adapté), idempotence (lecture pure) ; sans objet : migration.
- **Reste** : brancher la dernière position réelle quand GPS-API-1 existera (`CorridorRealPosition` est prêt) ; `GET /api/management/dashboard` reste réservé à admin et direction.

## 2026-11-10 - Correctifs de relecture (#656)
- Affectations retenues par `ACTIVE_ASSIGNMENT_STATUSES` ; tri secondaire par id de mission ; `currentStep` et `estimatedDistance` retirés du select.
- « En transit » exige une mission `in_progress` et une affectation `accepted` ou `in_progress` (décision 0a) ; `pending` donne `loading`.
- Cas de contrat : planifiée + en cours + affectation annulée + mission livrée sur un même véhicule.
- Bulle Leaflet : valeurs échappées (`client/src/lib/escape-html.ts`, test unitaire).
