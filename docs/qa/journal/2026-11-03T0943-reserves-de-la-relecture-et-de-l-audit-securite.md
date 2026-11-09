## 2026-11-03 09:43 — #130 : réserves de la relecture et de l'audit sécurité

- **Quoi** : l'identifiant de véhicule refuse aussi les zéros en tête et les valeurs hors int Postgres ; une erreur disque à la création du dossier devient une 500 générique avec référence ; le contrat vérifie le corps `ApiErrorBody` du 400 (commit 9802d6d, sans entrée à part, rattaché ici).
- **Comment** : `/^[1-9]\d{0,9}$/` borné à 2 147 483 647 ; `mkdirSync` dans un `try` qui passe une `AppError` à `cb`, relayée telle quelle par la route ; confinement factorisé en `isInsideDirectory` (`server/lib/uploaded-file.ts`), partagé avec `uploadedFileCandidates` ; garde-fou `multer-storage-hygiene` ; leçon dans `docs/analysis/LESSONS_LEARNED.md`.
- **Pourquoi** : réserves 1 à 4 de fleet-relecteur, mineurs M1 et M4 de fleet-securite. M2 (`err.message` multer et `looksTechnical` sans `EACCES`) et M3 (extension non confrontée au type MIME) sont antérieurs à la PR : suite à part.
- **Preuves** : garde-fou rouge sur l'ancien `upload.ts`, vert après ; contrats `vehicle-documents-upload-path` 7/7 et `vehicle-documents-upload` 16/16 sur le Postgres local ; unitaires `upload-vehicle-directory` et `multer-storage-hygiene` verts.


