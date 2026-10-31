# Journal — API 1 (`api-1`)

Worktree : `../fm-api-1`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-31T19:00:00+01:00 — T-40 — Routes des lectures agregees

- **Agent** : api-1 · **Branche** : `lot/api/T-40-routes` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : `GET /api/vehicles/:id/cost-summary`, `/api/tires/movements`, `/api/billing/pending-invoices`.
- **Comment** : trois routeurs branches sur `aggregateReadsService`, derriere leur drapeau SHOULD puis un `authorize` par ressource (cout : admin, direction, atelier, logistique ; pneus : + magasin et technicien ; factures : admin, direction, secretariat, logistique) ; 404 si vehicule inconnu ; zod sur params et requete.
- **Pourquoi** : P-14, P-15, P-21 ; le client n'accede a aucune de ces lectures.
- **Comment tester (QA)** : activer les drapeaux, ouvrir chaque ecran avec un compte autorise puis un client (403).
- **Preuve** : contrat `aggregate-reads` 4 verts ; `tsc` global 0 erreur.
- **Reste** : `/tires/movements` doit etre monte avant tout `/tires/:id` de `routes.ts` (ordre de montage a verifier par sol).
## T-13 - Liste des comptes verrouilles et deverrouillage admin

- Quoi : `GET /api/admin/users/locked` et `POST /api/admin/users/:id/unlock`, admin seul, dans `server/api/auth-lockout.routes.ts`.
- Comment : lecture de `users.locked_until > now()` mappee sur `lockedUsersResponseSchema` (sans mot de passe) ; le deverrouillage passe par `DbLockoutStore.unlockUser`, qui remet les compteurs a zero, supprime la ligne par identifiant et ecrit l'audit. 404 si l'id est inconnu, 400 si invalide. Rejouable.
- Pourquoi : un administrateur doit pouvoir lever un verrou sans attendre l'expiration (P-03).
- Preuve : `tests/contract/auth-lockout-admin.contract.test.ts` (3 verts) ; tsc global a zero.
- Reste : le scenario 5 echecs puis 429 depend du montage de `loginLockoutGuard` par sol ; le verrou est ici pose par `registerFailure`.
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
## 2026-10-30T18:40:00+01:00 - T-39 - Historique d'un ordre de travail

- **Agent** : api-3 (journal api-1) · **Branche** : `lot/api/T-39-audit-trail` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : `GET /api/work-orders/:id/audit-trail` a la place du squelette 501, conforme a `work-order-audit-trail.ts` (contrat inchange).
- **Comment** : lecture de `activity_logs` (`entity_type = 'work_order'`, `entity_id = :id`), jointure `users`, tri ancien vers recent, 1000 lignes au plus. Le mappage ligne vers contrat (`toAuditLogRow`, `server/lib/audit-log-row.ts`) est extrait de T-15 et partage. Gardes : drapeau (404), session, `isStaff` (client 403). Id non numerique, nul ou hors `integer` : 400 ; OT inconnu : 404 par `AppError`. Il n'existe pas de table d'historique de statut d'OT (`status_history` est celle des vehicules) : les changements de statut ressortent des ecritures auditees.
- **Pourquoi** : P-13, tracer qui a modifie l'OT sans acces base ; reutilisation (Adapt) de la logique T-15 plutot que copie.
- **Comment tester (QA)** : activer `FEATURE_FLAGS=work-order-audit-trail=on`, ouvrir `/api/work-orders/62/audit-trail` en personnel (liste chronologique), en client (403), avec `/abc` (400) et `/2000000000` (404).
- **Preuve** : contrat `work-order-audit-trail` 5 verts + `audit-logs` 3 verts (non-regression) ; `tsc` global a zero.
## 2026-10-30T20:00:00+01:00 - T-16b - Upload des documents vehicule deplace dans server/api, type valide

- **Agent** : api-3 (journal api-1) · **Branche** : `lot/api/T-16b-upload` · **Commit** : voir `git log` de la branche
- **Statut** : fait, preuve de contrat partielle (voir Preuve)
- **Quoi** : `POST /api/vehicles/:vehicleId/documents` deplace de `server/routes.ts` vers `server/api/vehicle-documents.routes.ts` ; le `type` doit etre un code actif de `vehicle_document_types`, sinon 400 « Type de document inconnu ou inactif. » et fichier supprime.
- **Comment** : meme chemin, meme garde `isWorkshopManager`, meme multer (`uploadVehicleDocument`), memes champs, meme reponse 201 ; `console.*` remplace par `moduleLogger`, erreurs par `AppError` (les erreurs multer deviennent des messages francais). Handler supprime de `routes.ts` (suppression seule, accord de l'utilisateur) ; aucune autre declaration de la route.
- **Pourquoi** : T-16 reste (validation a l'upload), sans aggraver la dette de `routes.ts` (AGENTS §9). Les anciens documents au type hors liste restent lisibles.
- **Comment tester (QA)** : en responsable atelier, televerser un PDF avec `type=carte_grise` (201), puis avec `type=nimporte` (400 lisible, rien sur disque) ; en technicien, 403.
- **Preuve** : `tsc` global a zero ; unitaires 541 verts ; premier passage des contrats `vehicle-documents-upload` (4) et `vehicle-documents-client-scope` (16) : 20 tests verts. Les suites echouent ensuite au teardown/setup sur la base partagee : des lignes `activity_logs` d'utilisateurs TEST laissees par mes premiers passages (l'intercepteur d'audit journalise l'upload) bloquent `cleanupOrphanTestRows`. Le test supprime desormais ces lignes ; le menage des restes anterieurs reste a faire.
