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
