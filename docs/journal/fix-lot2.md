# Journal — lot 2 : cloison client et it.fails restants (`fix-lot2`)

Worktree : `../fm-fix-lot2`. Branche : `fix/lot2-cloison-itfails`. Modèle d'entrée : `README.md`.

## 2026-11-02 — Cloison client sur les lectures véhicule, garde automatique

- **Quoi** : mileage, mileage/history, status-history, tires, fuel-records/vehicle, work-orders/vehicle, stats et anomalies carburant d'un véhicule, check/:registrationNumber : `isAnyUser` + `canAccessOwned` (403 hors périmètre). check-alerts filtré par `ownerScopeOf`. mileage/sync réservé au personnel (`isStaff`).
- **Comment** : gardes posées sur les handlers existants de `server/routes.ts` (aucune route ajoutée). Test unitaire `vehicle-routes-guard.test.ts` (liste gelée qui ne peut que diminuer) et contrat `vehicle-reads-client-scope`.
- **Pourquoi** : AGENTS.md §11, un client ne voit que ses véhicules.
- **Comment tester (QA)** : compte client : ses véhicules 200, ceux d'un autre 403 sur chaque lecture ci-dessus.

## 2026-11-02 — it.fails convertis : carburant, listes, véhicules

- **Quoi** : fuel-card (validation, codes d'erreur traduits en AppError), stats véhicule (id hors bornes), export carburant par période (COALESCE année/mois), listes (jokers LIKE échappés via `escapeLike`, bornes limit/offset), CRUD véhicules (pas d'historique parasite à la création, colonnes d'audit non écrasables, immatriculation en doublon : 409, nombres non finis refusés).
- **Preuve** : contrats fuel-card-routes, fuel-vehicle-stats, fuel-export-period, lists-pagination-filters, vehicles-crud, vehicle-reads-client-scope : verts.

## 2026-11-02 — it.fails convertis : catalogue MO, plans, mission, brouillon, véhicule supprimé, préventif

- **Quoi** : `PATCH /api/labor-catalog/:id` (libellé, heures, désactivation ; chef d'atelier seul) ; DELETE d'un plan portant un OT : 409 au lieu d'un 204 sans suppression ; lancement de mission refusé avec ses motifs dans le message ; PATCH d'un brouillon d'acquisition inconnu : 404 ; véhicule supprimé (deletedAt) : non assignable à une mission (400), ne reçoit plus d'OT (400) ; DELETE d'un véhicule référencé : suppression douce (deletedAt) au lieu d'un 500 ; préventif : anti-doublon par `maintenanceScheduleId` (le titre de l'OT généré n'est pas celui du plan), et OT généré à l'échéance d'un plan actif.
- **Reste** : cas `vehicle-status-sync` (annulation d'OT remet le véhicule en service), traité par fleet-db (trigger), `KNOWN_SETUP_IN_IT_FAILS` conservé tant que non fusionné.

## 2026-11-02 — Suites de relecture PR #80 : préventif, garde, routes masquées, nettoyage

- **Correction d'une entrée précédente** : la mention « `vehicle-status-sync` traité par fleet-db, `KNOWN_SETUP_IN_IT_FAILS` conservé tant que non fusionné » était fausse. Après #78, `KNOWN_SETUP_IN_IT_FAILS` était déjà vide et le cas `vehicle-status-sync` déjà converti en `it` sur `main`. Rien n'est conservé ni en attente.
- **Préventif (bloquant)** : un plan à échéance ne génère plus d'OT si un OT du plan est ouvert (en attente, démarré, en attente de pièces), ni si un OT non annulé porte déjà cette échéance (`startDate` >= échéance) : un OT clôturé ne ressuscite pas tant que l'échéance n'a pas avancé. Une exception sur un plan est journalisée (`moduleLogger`) et les autres plans continuent. Tests d'intégration : OT démarré, en attente de pièces, clôturé : 0 OT ; échéance avancée : 1 nouvel OT.
- **Garde de cloison** : `vehicle-routes-guard` résout le préfixe de montage de chaque routeur de `server/api` depuis `index.ts` (et ignore un routeur monté sous un garde de rôle). Preuve par mutation : `router.get("/:id/leak", authenticate, ...)` ajoutée dans `vehicles.routes.ts` fait échouer le test (`get /api/vehicles/:id/leak`), puis retirée.
- **Routes masquées** : `GET /api/vehicles/check-alerts` et `GET /api/vehicles/archived` étaient masquées par `/api/vehicles/:id`. Déplacées dans `server/api/vehicles.routes.ts` avant `:id`, même cloison (`ownerScopeOf`, `isAdmin`), erreurs en `AppError` ; handlers retirés de `routes.ts` (hors liste gelée de `routes-hygiene`). Assertion du contrat durcie : 200, filtrée sur le périmètre du client.
- **Mineurs** : `check/:registrationNumber` répond `exists:false` à un client pour une plaque d'un autre client (plus de 403 qui la révèle) ; second DELETE d'un véhicule déjà retiré : 404 ; heures standard invalides du catalogue : 400 ; garde d'hygiène `it.fails` : le balayage lit au moins un fichier.
- **Outillage** : `tests/support/cleanup.ts` supprime les `vehicle_acquisition_workflows` des comptes TEST* avant les comptes (la FK faisait échouer le hook de nettoyage et marquait tous les fichiers de contrat en échec).
