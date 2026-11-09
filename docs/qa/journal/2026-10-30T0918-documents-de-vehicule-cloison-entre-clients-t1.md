## 87c8678 - Documents de véhicule : cloison entre clients (T1)

**Quoi**
- Un client ne lit plus les documents des véhicules d'un autre client. Le personnel (tous rôles sauf
  `client`) les lit tous, pour un contrôle ou un travail.
- Objet isolé hors périmètre → 403 `FORBIDDEN` « Accès refusé : ce véhicule n'appartient pas à votre
  compte. » : `GET /api/vehicles/:id/documents`, `.../documents/:type`, `GET /api/documents/:id/download`,
  `GET /api/workflows/documents/:id`, et les écritures `PUT /api/vehicles/:id/mileage` et
  `.../maintenance-position`.
- Listes filtrées sur le propriétaire : `GET /api/vehicles/documents/all`, `expiring-docs`, `expired-docs`,
  `document-stats`, `all-with-status`, `GET /api/workflows/:sessionId/documents`.

**Comment**
- `isAnyUser` (`server/middleware/auth.ts`) charge `req.user` ; `authenticate` ne le faisait pas.
- Garde unique `server/lib/client-scope.ts` (`canAccessOwned`, `ownerScopeOf`), le personnel ne coûte
  aucune lecture. Services : `ownerId` optionnel (défaut `null` = pas de filtre, appelants inchangés).
- Workflow : filtre sur l'auteur du workflow, pas sur `sessionId` (non unique, testé).
- `console.*` des fonctions touchées migrés vers `moduleLogger` ; plus de `error.message` dans les 500
  de `vehicles.routes.ts`.
- Crescendo : unitaire du garde + matrice RBAC, puis contrat avec deux clients, un technicien et un admin.

**Pourquoi**
- Règle du commanditaire : documents visibles par tout le personnel, jamais d'un client à l'autre.
  Avant : une session suffisait, ids séquentiels.

**Preuve**
- `npm run check` 0 erreur ; unitaire 453/453 ; intégration 58/58 ; contrat complet 111/111 ;
  0 `TEST-` en base ni sur disque.
- Nouveau contrat `vehicle-documents-client-scope` : 11/11. Premier passage 10/11 : la fabrique de
  véhicules ignore `licensePlateExpiry`, date posée par une mise à jour dans le test.
- Sans correctif : 8 rouges sur 11 ; les 3 verts sont les accès autorisés (non-régression).

