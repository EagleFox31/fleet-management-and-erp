## Piste B, lot B2 : reprise de relecture (PR #72)

**Quoi**
- Mise en place sortie de chaque `it.fails` : `beforeAll` (ou `describe` dédié avec un it témoin) dans `vehicles-crud`, `vehicle-acquisition-workflow` et `mission-planning-conflict`. Un `it.fails` ne contient plus que l'appel visé et l'assertion métier ; l'assertion redondante `status === "assigned"` du lancement est retirée.
- Corrections de titres : détail `/api/vehicles/abc` (404, cherché comme immatriculation, `server/routes.ts:1052-1060`), PATCH qui modifie `notes`, « lancement refusé, statut inchangé ». Un doublon d'immatriculation qui passerait en 201 est ajouté à `ids.vehicleIds` pour le ménage.
- Correction du décompte des défauts produit : VEH1 4 (5 `it.fails`), VEH3 **5** (et non 1), MIS2 1, soit 10 (la mention « six défauts » du journal du lot B2 est à lire ainsi). Les quatre défauts VEH3 non documentés le sont désormais (commentaire DEFAUT PRODUIT, cause, fichier:ligne) :
  - `POST` sans validation (`server/routes.ts:5654`) : corps vide et `currentStep: "abc"` donnent 500 (`server/services/workflow-service.ts:36-42`) ;
  - `PATCH` d'une session inconnue : 200 et corps `null` (`workflow-service.ts:100`, `routes.ts:5710-5711`) ;
  - `PATCH` : `status` du corps étalé dans le `set` (`workflow-service.ts:88`), comme `userId`.

**Pourquoi**
- Un `it.fails` qui crée sa donnée passe au vert si la création échoue : il ne prouve plus le défaut. Garde-fou de la PR #73 (`it-fails-hygiene`).

**Preuve**
- Rouge sans `.fails` (log `b2r-rouge.log`, copies temporaires supprimées) : 11 échecs, tous sur l'assertion métier : 2 lignes d'historique au lieu d'1 ; 500 au lieu de 400 (année, kilométrage, corps vide, étape) ; PATCH immatriculation prise 500 ; `createdBy` et `userId` réécrits (id différent) ; PATCH inconnu 200 au lieu de 404 ; statut `completed` au lieu de `in_progress` ; motif « Conflit planning » absent.
- Vert avec `.fails` : trois fichiers ensemble, 58/58 (`b2r-vert.log`). `tsc` (tsconfig temporaire incluant les trois tests) : 0 erreur. `it-fails-hygiene` : 7/7, liste gelée inchangée.

**Reste**
- Défauts produit à corriger par fleet-api / fleet-db. e2e VEH3 non fait.

