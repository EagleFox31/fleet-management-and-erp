## 2026-11-03 16:59 — Ménage des restes de test : pleins d'un véhicule orphelin

- **Quoi** :
  - `deleteOrphanTestRows` supprime les pleins d'un véhicule orphelin avant le véhicule, quelles que soient leurs notes.
  - Test : `tests/integration/test-cleanup-orphan-fuel-records.test.ts`.
- **Pourquoi** : signalé par aa.
  - Sur la base de contrat partagée, `fuel_records_vehicle_id_vehicles_id_fk` bloquait la suppression d'un véhicule orphelin.
  - Chaque fichier de contrat ressortait donc en échec alors que ses tests passaient.
  - Le balayage par préfixe des notes ne voit pas un plein saisi sans préfixe.
- **Preuves** :
  - rouge sans la ligne : 1 échec ;
  - vert 6/6, avec la garde des FK vers users et le test status_history ;

