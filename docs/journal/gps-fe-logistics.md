# Journal : GPS V1 téléphone, côté logisticien (FE)

## Quoi

- Saisie des points A et B à la création d'une mission (étape 2 de l'assistant) et à la modification (onglet « Suivi GPS » de la fiche mission) : un hub du référentiel CEMAC (liste, utilisable au clavier) ou un point posé sur la carte.
- Écran `/fleet/map` (CDC-6) branché sur `GET /api/vehicle-positions` : carte + tableau, dernière position et âge (« il y a N min », couleur selon 15 / 60 min).
- Onglet « Suivi GPS » d'une mission : dernière position, trace (`GET /api/missions/:id/track`), une polyligne par véhicule (`vehicleId`), points suspects en cercles orange hors trait.
- Correctif CARTO : `executive-corridor-map.tsx` passe par `client/src/lib/map-tiles.ts` (plus aucune URL de tuiles en dur ; test d'hygiène).
- Temps réel : `vehicle_position_updated` invalide aussi la trace de la mission annoncée (toutes les traces ouvertes si `missionId` manque).

## Comment

- Choix reuse : Leaflet « vanilla » (même motif que `executive-corridor-map.tsx`, Leaflet déjà installé) plutôt que react-leaflet 4.2.1, absent du dépôt et à ajouter à un `node_modules` partagé. Cartes chargées en lazy.
- Contrat zod : `shared/contracts/gps.ts` ; helpers purs : `client/src/lib/gps-display.ts` ; hooks : `client/src/hooks/use-gps.ts`.
- Rôles : positions = `GPS_VIEW_ROLES`, trace = `GPS_TRACK_ROLES` (le chef d'atelier ne la demande pas : aucun appel, rien dessiné), édition A/B = `MISSION_GEO_WRITE_ROLES`. Drapeau `gps` coupé : écran, onglet et appels absents.
- `PATCH /geo` n'émet aucun événement serveur : invalidation locale (détail, liste, trace).
- Texte injecté dans les bulles : `escapeHtml`.

## Pourquoi

Le logisticien suit un camion sans position inventée (leçon GPS-FE-4) et prépare le départ et la livraison sur carte, sans géocodage externe.

## Comment tester

- `node node_modules/vitest/vitest.mjs run tests/unit/client/gps-display.test.ts tests/unit/client/gps-realtime.test.ts tests/unit/client/realtime-invalidation-keys.test.ts`
- Navigateur : serveur avec `FEATURE_FLAGS=gps=on`, base locale, comptes logistics / workshop_manager / technician ; `/fleet/map` et `/missions/:id`, onglet « Suivi GPS ».
- Limite : la pose d'un point sur la carte est un geste à la souris ou au doigt ; l'alternative clavier est la liste des hubs.
