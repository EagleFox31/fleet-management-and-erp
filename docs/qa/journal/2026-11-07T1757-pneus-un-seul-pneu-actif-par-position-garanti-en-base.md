## 2026-11-07T17:57:52+01:00 — Pneus : un seul pneu actif par position, garanti en base

- **Statut** : fait (PR brouillon)
- **Quoi** : le contrôle « position libre » de `installTireOnVehicle` (SELECT avant INSERT) laissait passer deux montages simultanés sur la même position. Index unique partiel `uq_vehicle_tires_active_position` sur `vehicle_tires (vehicle_id, position) WHERE status = 'active'`. Dans la même PR, deux mineurs de #592 : le sélecteur de véhicules du dialogue de montage (fetch maison, `= []`) et le Select des pneus montés du formulaire d'inspection (vide en cas d'erreur).
- **Comment** :
  - index posé par `init-database.ts` et sa migration jumelle, sous verrou consultatif, seulement sans doublon ; sinon WARNING, aucune correction, couples (véhicule, position) journalisés par `reportVehicleTireActivePositionGaps` ;
  - 23505 de l'index → 409 « position occupée » à l'installation et à la modification ; `updateVehicleTire` relance (409/500) au lieu de renvoyer `undefined` ; une ligne ajoutée dans le catch existant de `PATCH /api/vehicle-tires/:id` (`server/routes.ts`) pour transmettre l'`AppError`, aucune route ajoutée ;
  - écrans : `queryView` + `InlineQueryError` ; le sélecteur de véhicules passe par la queryFn par défaut.
- **Comment tester (QA)** :
  - contrat concurrence : rouge sans l'index (`[201, 201]`), vert avec (`[201, 409]`, stock 5 → 4) ;
  - intégration (4 tests) : doublons existants, doublon réglé, second démarrage sans écriture ;
  - unitaires : schéma/SQL (4) et conflit 23505 (6), rouges avant ; garde de branchement des écrans pneus étendue (2 cas, rouges sur les écrans d'avant) ;
  - campagnes : tsc 0, check:tests 0, unitaires 310 fichiers / 3218 tests, contrats pneus 8 fichiers / 102 tests sur Postgres local.
- **RAIDER** :
  - R : modèle de réconciliation de `uq_drivers_user_id`, `queryView` et `InlineQueryError` existants ;
  - I : second démarrage sans écriture, prouvé ;
  - D : succès inchangés, 409 déjà renvoyé par le contrôle ; contrats verts ;
  - Retroactive : aucune donnée modifiée, doublons signalés, pas corrigés ;
  - failure memory : leçon du 2026-11-07 dans `LESSONS_LEARNED.md`.

  Ne s'applique pas : A (pas de dépendance d'environnement nouvelle).
- **Reste / risques** : en prod, si des doublons existent, l'index reste absent jusqu'au démontage par l'atelier (WARNING au démarrage). Revue sécurité prévue (stock).

