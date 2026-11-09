## 2026-11-03 16:55 — Couche 3 : kilométrage et position d'atelier ciblés par véhicule

- **Quoi** :
  - Le groupe vehicleOperations ne rafraîchit plus toutes les fiches véhicule (préfixe `/api/vehicles/`). Il rafraîchit la fiche du véhicule touché, par `/api/vehicles/<id>` et par l'immatriculation, ainsi que les listes `/api/vehicles`, `/all` et `/all-with-status`.
  - Gabarits `byId` dans `realtime-satellites.ts`, remplis depuis la charge de l'événement.
  - Sans identifiant dans la charge, repli sur le préfixe large.
- **Pourquoi** : un relevé de kilométrage invalidait chaque fiche, chaque liste de documents et chaque liste de pneus ouvertes dans le cache de tous les profils.
- **Preuves** :
  - rouge contre main : 1 échec sur le ciblage ;
  - vert 16/16 ;

