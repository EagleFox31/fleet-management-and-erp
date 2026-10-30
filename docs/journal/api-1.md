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

## 2026-10-30T19:00:00+01:00 - T-16 (restes) - Evenement temps reel des types de document

- **Agent** : api-3 (journal api-1) · **Branche** : `lot/api/T-16-restes` · **Commit** : voir `git log` de la branche
- **Statut** : (a) fait ; (b) validation a l'upload non implementee, bloquee par `server/routes.ts`
- **Quoi** : `vehicle_document_type_changed` emis apres chaque creation et modification dans `server/api/vehicle-document-types.routes.ts`.
- **Comment** : `broadcastUpdate(event, { entity, payload: { code }, scope })` via `global.broadcastUpdate` (convention des routeurs `server/api`), portee lue dans `REALTIME_EVENTS` (broadcast). Pas d'emission sur 409/404/400. Test avec espion sur la fonction globale.
- **Pourquoi** : couche 2 de la regle des 3 couches ; les ecrans qui listent les types se resynchronisent sans polling.
- **Comment tester (QA)** : deux sessions, l'admin cree puis desactive un type ; l'autre session voit la liste des types a jour sans recharger.
- **Preuve** : contrats `vehicle-document-types` (5) et `vehicle-document-types-realtime` (1) verts ; unitaires verts ; `tsc` global a zero.
- **Reste (b)** : la route d'upload est `POST /api/vehicles/:vehicleId/documents` dans `server/routes.ts` (l. 1334), multipart traite par multer dans la route ; aucun double dans `server/api/`.
