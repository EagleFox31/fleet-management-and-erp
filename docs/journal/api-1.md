# Journal — API 1 (`api-1`)

Worktree : `../fm-api-1`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-31T17:00:00+01:00 — T-16 — Referentiel des types de document vehicule

- **Agent** : api-1 · **Branche** : `lot/api/T-16-document-types` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : `GET/POST /api/vehicle-document-types` et `PATCH /api/vehicle-document-types/:code`, a la place du squelette 501.
- **Comment** : routeur dans `server/api/vehicle-document-types.routes.ts` (drizzle, zod du contrat, `AppError`, `moduleLogger`) ; GET pour tout connecte, types inactifs reserves a l'admin (`?includeInactive=true`) ; POST/PATCH admin ; doublon 409 ; aucune route de suppression.
- **Pourquoi** : P-05, un type se desactive, `vehicle_documents.type` reste du texte libre. Branche issue de T-08 avec T-07 fusionnee (table et graine).
- **Comment tester (QA)** : admin, creer un type, le desactiver ; un technicien ne le voit plus ; POST en technicien, 403.
- **Preuve** : contrat `vehicle-document-types` 5 verts ; `tsc` global sans erreur.
## T-15 - Lecture du journal d'audit

- Quoi : `GET /api/audit-logs`, admin seul, dans `server/api/audit-logs.routes.ts`.
- Comment : requete sur `activity_logs` jointe a `users`, filtres userId, entityType, entityId (numerique ou reference), plage par defaut 31 jours, page bornee a 100, tri recent d'abord. Les `details` repassent par `maskSecrets` a la lecture ; une action historique hors enum (ex. majuscules) est ramenee en minuscules, a defaut `update`.
- Pourquoi : consulter qui a fait quoi (P-04) sans acces base.
- Preuve : `tests/contract/audit-logs.contract.test.ts` (3 verts : 401/403, filtres, masque, plage, pagination) ; tsc global a zero.
- Reste : l'intercepteur `auditWrites` n'est pas monte ici (sol) ; le test insere ses lignes directement.

## 2026-10-30T20:00:00+01:00 - T-16b - Upload des documents vehicule deplace dans server/api, type valide

- **Agent** : api-3 (journal api-1) · **Branche** : `lot/api/T-16b-upload` · **Commit** : voir `git log` de la branche
- **Statut** : fait, preuve de contrat partielle (voir Preuve)
- **Quoi** : `POST /api/vehicles/:vehicleId/documents` deplace de `server/routes.ts` vers `server/api/vehicle-documents.routes.ts` ; le `type` doit etre un code actif de `vehicle_document_types`, sinon 400 « Type de document inconnu ou inactif. » et fichier supprime.
- **Comment** : meme chemin, meme garde `isWorkshopManager`, meme multer (`uploadVehicleDocument`), memes champs, meme reponse 201 ; `console.*` remplace par `moduleLogger`, erreurs par `AppError` (les erreurs multer deviennent des messages francais). Handler supprime de `routes.ts` (suppression seule, accord de l'utilisateur) ; aucune autre declaration de la route.
- **Pourquoi** : T-16 reste (validation a l'upload), sans aggraver la dette de `routes.ts` (AGENTS §9). Les anciens documents au type hors liste restent lisibles.
- **Comment tester (QA)** : en responsable atelier, televerser un PDF avec `type=carte_grise` (201), puis avec `type=nimporte` (400 lisible, rien sur disque) ; en technicien, 403.
- **Preuve** : `tsc` global a zero ; unitaires 541 verts ; premier passage des contrats `vehicle-documents-upload` (4) et `vehicle-documents-client-scope` (16) : 20 tests verts. Les suites echouent ensuite au teardown/setup sur la base partagee : des lignes `activity_logs` d'utilisateurs TEST laissees par mes premiers passages (l'intercepteur d'audit journalise l'upload) bloquent `cleanupOrphanTestRows`. Le test supprime desormais ces lignes ; le menage des restes anterieurs reste a faire.
