## 0d015a2 - Pneus : RBAC magasin / atelier et suppression douce (TIR1–TIR4)

**Quoi**
- Fiche pneu supprimée (douce) : invisible au détail (`GET /api/tires/:id` 404), non modifiable
  (`PATCH` 404), non resupprimable (`DELETE` 404). Fiche inexistante : 404 au lieu de 200 vide.
- `DELETE /api/tires/:id` : pneu monté → 409 avec un message lisible ; plus de `error.message` brut en 400.
- `PATCH /api/vehicle-tires/:id/remove` : montage inconnu ou déjà démonté → 404 (le service rendait
  toujours `true`).
- `POST /api/tire-rotations` : corps validé (400 `VALIDATION`) ; OT et rotation créés dans une même
  transaction, une rotation refusée ne laisse plus d'OT orphelin. Véhicule inconnu → 404.
- `POST /api/tire-inspections` : corps validé (400 `VALIDATION`, plus de 500) ; l'inspecteur reste
  l'auteur de la requête.

**Comment**
- `server/services/tires-service-simplified.ts` : filtre `deletedAt IS NULL` sur `getTire` / `updateTire`,
  `updateTire` ne masque plus les erreurs, `removeTireFromVehicle` filtre `status = 'active'` et lit le
  `returning`, `AppError` 404 / 409 dans `deleteTire`, `db.transaction` pour OT + rotation. Les `console.*`
  touchés passent par `moduleLogger("tires")`.
- `server/routes.ts` (correction en place, aucune route ajoutée) : `insertTireInspectionSchema` et
  `insertTireRotationSchema` (sans `workOrderId`, `performedBy`, `createdBy` ; coût accepté en nombre,
  comme l'envoie le formulaire) ; `AppError` et `ZodError` confiés au gestionnaire central.
- Contrat `tests/contract/tires-rbac.contract.test.ts` : quatre rôles réels (admin, magasinier, chef
  d'atelier, technicien), 15 cas.

**Pourquoi**
- Feuille PNEUMATIQUE (AGENTS.md §5) : le magasin tient la fiche, l'atelier monte, tourne et démonte,
  le technicien inspecte. Le RBAC tenait déjà ; les cas d'erreur, eux, répondaient 200, 400 brut ou 500.
- Une fiche supprimée qui reste modifiable ou consultable contredit la suppression douce (TIR2).

**Preuve**
- Premier passage sur l'ancien code : 7 rouges sur 15 (PATCH inexistant 200, DELETE 400 au lieu de
  404 / 409, détail d'une fiche supprimée 200, démontage inconnu 200, rotation et inspection invalides 500).
- `npm run check` 0 erreur ; unitaire 474/474 ; intégration 67/67 (13 fichiers) ; contrat 145/145 (16 fichiers).

