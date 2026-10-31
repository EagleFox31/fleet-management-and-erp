# Journal — API 1 (`api-1`)

Worktree : `../fm-api-1`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T15:00:00+01:00 — T-11a/T-11b/T-62 — Garde de role des exports et isStaff au montage

- **Agent** : api-1 · **Branche** : `lot/api/T-11-exports-garde` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : un client, un chauffeur ou un technicien ne telecharge plus les exports (403) ; un client ne lit ni n'ecrit plus sur warehouse, fuel-card, drivers, missions, clients, operations, part-requirements (403).
- **Comment** : `server/middleware/exports-guard.ts` (coupe-circuit `exports` -> 404, `isAnyUser`, puis `canExport` sur `EXPORT_ROLE_MATRIX`, refus par defaut) ; `server/api/index.ts` : uniquement les lignes de montage des 8 prefixes (+ import). Test `tests/contract/lot-exports-roles.contract.test.ts`. Coupe-circuit local (`resolveFeatureFlags`) a remplacer par `requireFeature` de T-08. Adopt `isStaff`/`isAnyUser`, Build la garde.
- **Pourquoi** : P-01, AGENTS section 11, plan 05-api T-11a/b et T-62.
- **Comment tester (QA)** :
  - Prerequis : un compte par role.
  - Etapes : 1. GET /api/exports/inventory avec client puis admin. 2. GET /api/missions avec client puis driver.
  - Attendu : client 403 ; admin 200 ; driver 200.
  - Preuve automatisee : `node ../lot-tools/db-lock.mjs api-1 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/lot-exports-roles.contract.test.ts` -> ROUGE avant (65 failed | 52 passed), VERT apres (117 passed). tsc global : 0 erreur.
- **RAIDER** : R/A matrice et roles lus des contrats ; I sans ecriture ; D technician/driver non refuses sur les montages staff ; E AppError, refus par defaut. Failure memory : le test de garde de session ne prouve pas la garde de role.
- **Reste / risques** : les `res.status(500).json({error: error.message})` et `console.*` de exports.routes.ts restent (T-11a, a faire) ; routes.ts sert /api/exports/{vehicles,work-orders,fuel,users,complete} avec `authenticate` seul : elles tombent maintenant sous la garde et recoivent 403 pour tous (y compris admin) ; pages/reports/index.tsx et exportsService (`/exports/fuel`) en dependent.

## 2026-10-31T16:00:00+01:00 — T-11 — Exports : garde par drapeau, rôles par chemin, entrées validées

- **Agent** : api-1 · **Branche** : `lot/api/T-11-exports-garde` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : la garde d'export passe par `requireFeature("exports")` ; les 5 exports de la page Rapports (vehicles, work-orders, fuel, users, complete) restent servis à l'admin ; année et mois validés ; erreurs normalisées.
- **Comment** : `server/middleware/exports-guard.ts` délègue à T-08 ; `server/api/exports.routes.ts` utilise `AppError` et `moduleLogger`, nom de fichier assaini dans `Content-Disposition` ; `EXPORT_ROLE_MATRIX` étendue aux 5 chemins.
- **Pourquoi** : la régression rendait un 403 à l'admin sur ces chemins ; le coupe-circuit local dupliquait le drapeau.
- **Comment tester (QA)** : connecté admin, ouvrir Rapports et lancer les 5 exports ; hors admin, 403 ; année invalide, 400 lisible.
- **Preuve** : contrat `lot-exports-roles` 174 verts ; `tsc` global sans erreur.
## 2026-10-31T20:00:00+01:00 — T-42 — Route de traitement des anomalies carburant

- **Agent** : api-1 · **Branche** : `lot/api/T-42-routes` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : `PATCH /api/fuel-card/anomalies/:id` et diffusion de `fuel_anomaly_resolved`.
- **Comment** : `server/api/fuel-anomalies.routes.ts` derriere le drapeau `fuel-anomalies` et `isFuelCardManager`, cle validee par zod, `fuelAnomalyResolutionService.resolve`, puis `broadcastUpdate` avec la portee declaree dans `REALTIME_EVENTS`.
- **Pourquoi** : P-18 ; la derniere decision l'emporte, le PATCH est rejouable.
- **Comment tester (QA)** : traiter une anomalie en logistique, la rouvrir ; technicien, 403.
- **Preuve** : contrat `fuel-anomalies` 4 verts ; `tsc` global 0 erreur. Le nettoyage global `cleanupOrphanTestRows` a signale une violation de cle etrangere sur `parts_stock_movements` (lignes d'un autre agent sur la base partagee), sans lien avec ce test.
## 2026-10-31T18:00:00+01:00 — T-25 — Routes KPI de la direction

- **Agent** : api-1 · **Branche** : `lot/api/T-25-kpi-routes` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : `GET /api/kpi/incidents-per-month`, `/preventive-compliance`, `/avg-cost-per-intervention`.
- **Comment** : `server/api/kpi.routes.ts` branche `kpiService` (db-2) derriere `isManagementOrAdmin` ; periode validee par le contrat zod (400 si inversee).
- **Pourquoi** : P-10, indicateurs de la direction ; technicien et client refuses.
- **Comment tester (QA)** : connecte direction, ouvrir les indicateurs ; technicien, 403.
- **Preuve** : contrat `kpi` 5 verts ; `tsc` global 0 erreur.
## 2026-10-31T21:00:00+01:00 — T-45 — Routes du pointage

- **Agent** : api-1 · **Branche** : `lot/api/T-45-routes` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : `GET /api/time-tracking`, `PUT /api/time-tracking`, `GET /api/time-tracking/monthly-stats`, evenement `time_tracking_updated`.
- **Comment** : `server/api/time-tracking.routes.ts` derriere le drapeau `time-tracking` ; lecture admin, secretariat, direction ; saisie admin et secretariat ; personne inconnue 404 ; portee de l'evenement lue dans `REALTIME_EVENTS`.
- **Pourquoi** : P-20 ; une saisie par personne et par jour, rejouable, totaux calcules a la lecture.
- **Comment tester (QA)** : saisir JT puis M le meme jour au secretariat ; le total du mois suit ; la direction lit mais ne saisit pas.
- **Preuve** : contrat `time-tracking` 3 verts ; `tsc` global 0 erreur.
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
## 2026-10-31T19:30:00+01:00 - R-03 / R-13 - Cloison client sur le parc, cloison chauffeur sur CPC et missions

- **Agent** : api-1 · **Branche** : `lot/api/R-03-cloison-vehicules-chauffeurs` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : un client ne voit plus que ses vehicules sur `GET /api/vehicles` et `/api/vehicles/all`, et `/api/vehicles/check/:immat` ne revele plus un vehicule hors perimetre ; un chauffeur ne voit que sa fiche sur `GET /api/drivers`, `/cpc-status`, `/expiring-cpc` et que ses missions sur `GET /api/missions`.
- **Comment** : routeur `vehicles-client-scope.routes.ts` monte avant `/vehicles` (et donc avant `routes.ts`, `/api` etant servi en premier) ; le personnel passe par `next()` vers le handler historique, inchange. Client : `vehicle-scope-service.ts` (Drizzle, meme forme `{ vehicles, total }` que `storage.getVehicles`, filtre `ownerScopeOf`). Chauffeur : filtre `drivers.userId` dans `drivers.routes.ts`, sous-requete `assignments -> drivers.userId` dans `missions.routes.ts`. Logs et erreurs des handlers touches migres (`moduleLogger`, `AppError`).
- **Pourquoi** : R-03 et R-13 de la repetition generale de recette ; AGENTS §11.
- **Comment tester (QA)** : connecte en client, `GET /api/vehicles` ne liste que ses vehicules ; `check/` d'une plaque d'autrui renvoie `{ exists: false }`. Connecte en chauffeur, `GET /api/drivers/cpc-status` renvoie une seule fiche, `GET /api/missions` ses missions. Admin et chef d'atelier : vue complete.
- **Preuve** : contrat `fleet-read-scope` 12 verts ; `tsc` global 0 erreur ; unitaires 781 verts.
- **RAIDER** : couvert non-regression (personnel inchange), moindre privilege, erreurs lisibles ; sans objet : migration.
- **Reste / risques** : `GET /api/drivers/:id`, `/:id/cpc-status`, `/:id/missions` et `POST /:id/update-cpc` restent ouverts a tout le personnel, chauffeur compris ; la reponse CPC expose CNI, permis et date de naissance a tout le personnel (voir PR).
## 2026-10-31T20:30:00+01:00 - R-13 (suite) - Routes chauffeur par identifiant fermees, fiche allegee

- **Agent** : api-1 · **Branche** : `lot/api/R-03-cloison-vehicules-chauffeurs` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : un chauffeur n'accede plus (403) a `GET /api/drivers/:id`, `/:id/cpc-status`, `/:id/missions` d'un autre chauffeur, ni a `GET /api/missions/:id` d'une mission non affectee ; `POST /api/drivers/:id/update-cpc` lui est refuse (il passait, la route n'est gardee que par `isStaff`). CNI, n° de permis et date de naissance ne sortent plus que pour admin, logistics, secretary (et le chauffeur sur sa propre fiche) sur `/api/drivers`, `/cpc-status`, `/expiring-cpc`, `/:id`, `/:id/cpc-status`.
- **Comment** : `server/lib/driver-scope.ts` (`assertOwnDriverRecord`, `assertOwnMission`, `refuseDriver`, `redactDriverPersonalData`), appeles avant le `try` des handlers pour que l'`AppError` 403 ne soit pas avalee par leur catch. Autres roles inchanges.
- **Pourquoi** : suite du bloquant R-13 ; minimisation des donnees personnelles decidee par l'utilisateur.
- **Ecrans verifies** : dashboards chef d'atelier et secretaire ne lisent aucun de ces champs ; `/drivers` et `/drivers/:id` sont reserves aux gestionnaires. A signaler : `missions/new.tsx:540` affiche `licenseNumber` du chauffeur choisi (ecran ouvert a tout compte connecte) : un non-gestionnaire verra « N/A ».
- **Preuve** : voir PR #53.
