# Journal — kilométrage chauffeur cloisonné (lot CDC-mileage-driver-scope)

## 2026-11-03 09:57 — Un chauffeur ne saisit que le véhicule de son affectation active

**Quoi.** `PUT /api/vehicles/:id/mileage` restait ouvert à tout le personnel (`isStaff`), chauffeur compris, sur n'importe quel véhicule. Un chauffeur pouvait donc fausser le compteur d'un véhicule qui n'est pas le sien, et en rejeu hors ligne (#10b) écrire sur un véhicule rendu.

**Comment.** La requête des véhicules affectés, jusque-là privée à `incident-service`, devient `assignedVehicleIdsOf` dans `server/lib/driver-scope.ts`. Les pannes l'appellent sans changement de comportement. La route vérifie `canWriteVehicleMileage` avant toute écriture : chauffeur hors affectation active → 403 « Vous ne pouvez saisir le kilométrage que du véhicule qui vous est affecté. ». Le 403 libère la clé d'idempotence.

**Pourquoi.** Option A validée par 0a : règle stricte, sans tolérance après clôture. Une seule définition d'« affecté » pour les pannes et le kilométrage.

**Preuves.** Contrat `vehicle-mileage-driver-scope` 4/4 (autre véhicule 403 sans écriture ni clé, son véhicule 200, après clôture 403, personnel 200). Mutation (garde retirée) : 2 rouges. `idempotency-driver-writes` adapté : ses saisies de kilométrage visent désormais un véhicule affecté, avec une seule fiche par compte (`uq_drivers_user_id`, #113).
