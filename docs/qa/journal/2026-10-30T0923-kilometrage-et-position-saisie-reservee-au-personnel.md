## 52487da - Kilométrage et position : saisie réservée au personnel

**Quoi**
- `PUT /api/vehicles/:id/mileage` et `.../maintenance-position` : un client est refusé (403), même sur
  son propre véhicule. Le personnel (tous rôles sauf `client`) saisit sur tout véhicule.
- Véhicule inexistant : 404 « Véhicule introuvable. » au lieu d'une 500 « Erreur serveur ».
- Kilométrage en baisse : 400 avec le message métier au lieu d'une 500.

**Comment**
- Nouveau garde `isStaff` (`server/middleware/auth.ts`), dérivé de `ALL_APP_ROLES` ; le contrôle de
  propriétaire devenu sans objet sur ces deux routes est retiré.
- `vehicle-documentation-service.ts` lève `AppError(404)` / `AppError(400)` ; les routes les passent
  déjà au gestionnaire central.
- Crescendo : matrice RBAC (`isStaff`), puis contrat `vehicle-documents-client-scope` (client sur son
  véhicule, baisse de kilométrage, véhicule absent).

**Pourquoi**
- Règle du commanditaire : un client ne saisit pas lui-même son kilométrage.
- Une 500 se lit « le serveur est en panne » ; l'utilisateur doit lire « ce véhicule n'existe pas ».

**Preuve**
- `npm run check` 0 erreur ; unitaire 467/467 (matrice RBAC 201/201) ; contrat
  `vehicle-documents-client-scope` 14/14.
- Sans correctif serveur : 3 rouges sur 14 (client sur son véhicule, baisse, véhicule absent).

