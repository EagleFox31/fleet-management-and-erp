## 2026-11-03 09:39 — #130 : l'identifiant de véhicule ne sort plus de uploads/ au dépôt de document

- **Quoi** : `POST /api/vehicles/:vehicleId/documents` refuse en 400 « ID de véhicule invalide » tout identifiant qui n'est pas fait de chiffres seuls. Avant, `1..%2F..%2F..%2F..%2Fx` passait `parseInt` (1) et multer créait le dossier `x` à la racine du dépôt.
- **Comment** : `isVehicleIdSegment` et `vehicleDocumentDirectory` dans `server/middleware/upload.ts`. La route valide avant multer ; la destination multer revalide et vérifie que le chemin résolu reste sous `uploads/documents` (défense en profondeur, aussi pour l'import gelé de `routes.ts`). Le chemin stocké garde sa forme relative. Les deux autres `diskStorage` (renouvellements, factures fournisseur) ont un dossier fixe : non concernés.
- **Pourquoi** : AGENTS.md §9, une valeur de requête ne devient un segment de chemin qu'après validation. Relevé par la relecture sécurité de #126.
- **Preuves** : rouge avant correctif, dossier `pwn130-*` créé hors de `uploads/` pour les 3 profondeurs, et 500 au lieu de 400. Vert après : contrats `vehicle-documents-upload-path` 4/4 et `vehicle-documents-upload` 16/16 sur le Postgres local ; unitaire `upload-vehicle-directory` 12/12 ; `tsc` 0 erreur ; `npm test` 1549/1549.
- **Pièges** : le passage rouge laisse les dossiers créés ; le test les nettoie en `afterAll`, y compris `vehicle-12abc`.

