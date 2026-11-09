## Piste B, lot B2 : VEH1, VEH3, MIS2 (contrat)

**Quoi**
- Trois fichiers de contrat exécutés pour la première fois : `vehicles-crud` (VEH1), `vehicle-acquisition-workflow` (VEH3), `mission-planning-conflict` (MIS2). Corrigés : délais de describe à 180 s, `notes` à la place d'une colonne `color` inexistante, `GET /api/vehicles/abc` attendu en 404 (valeur cherchée comme immatriculation).
- Défauts produit figés en `it.fails`, sans toucher au code produit :
  - statut initial consigné deux fois (`server/storage.ts:871` et `server/routes.ts:1090`) ;
  - `year` / `mileage` non numériques : 500 au lieu de 400 (`shared/schema.ts:154-155`) ;
  - `PATCH /api/vehicles/:id` : `createdBy` du corps réécrit l'auteur (`server/routes.ts:1195`) ;
  - `PATCH /api/vehicles/:id` : immatriculation déjà prise, 500 (`server/storage.ts:910`, `server/routes.ts:1204`) ;
  - `PATCH /api/workflows/vehicle-acquisition/:id` : `userId` du corps réaffecte le brouillon (`server/services/workflow-service.ts:88`) ;
  - lancement de mission refusé : motifs réduits à « Ce champ n'est pas valide. » (`server/api/missions.routes.ts:2366`).

**Pourquoi**
- Ces fichiers étaient écrits mais jamais exécutés : leur couverture n'était pas prouvée.

**Preuve**
- Rouge en `it` avant `it.fails` : 2 lignes d'historique au lieu d'1, `year`/`mileage` 500, `createdBy` et `userId` réécrits, immatriculation en double 500, motif absent. Vert ensuite : vehicles-crud 22/22, acquisition + mission 34/34 (run4). `tsc` 0 erreur, unitaire 845/845.

**Limites**
- Le 400 du lancement de mission ne prouve pas le conflit seul (la mission de test n'a pas de budget) : le conflit est prouvé par `launch-readiness`.
- Un e2e VEH3 (parcours écran) reste à faire.

**Reste**
- MIS1 et P2 (rejouer `e2e/05`), lots B3 et B4 non commencés.

