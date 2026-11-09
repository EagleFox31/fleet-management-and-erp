## 3572b2e - Pneus : le démontage dit où va le pneu (TIR3)

**Quoi**
- Démonter un pneu exige une destination : **Remettre en stock** (la fiche regagne une unité,
  `updated_by` = qui démonte) ou **Mettre au rebut** avec un motif obligatoire (usé, endommagé,
  crevé non réparable ; stock inchangé). Avant, le démontage ne touchait jamais le stock.
- `PATCH /api/vehicle-tires/:id` (édition générique) refuse les champs de cycle de vie
  (`status`, `tireId`, `vehicleId`, dates et kilométrage de démontage) : 400 lisible. On pouvait
  passer un montage à `removed` sans effet stock.
- Écran « Pneus montés » : bouton « Démonter » (chef d'atelier, admin), dialogue avec destination,
  motif, kilométrage (au moins celui du montage) et observation ; badge de statut lisible.

**Comment**
- `shared/constants/tire-removal.ts` : destinations, motifs, libellés, `tireRemovalSchema` (Zod),
  `vehicleTireStatusAfterRemoval`. Le statut existant `vehicle_tires.status` porte la destination
  (`removed` = remis en stock, `worn` / `damaged` / `punctured` = rebut) : aucune colonne ajoutée.
- `removeTireFromVehicle` : démontage et retour en stock dans une même transaction ; fiche supprimée
  → 409 « choisissez la mise au rebut ». Trame `vehicle_tire_removed` avec `destination`.
- `server/routes.ts` : corrections en place des deux PATCH existants, aucune route ajoutée.
- Client : `vehicle-tire-remove-dialog.tsx`, `useSingleFlightMutate`, invalidation fiches,
  statistiques, stock bas et pneus du véhicule (AGENTS.md §2).

**Pourquoi**
- Les logiciels de flotte imposent ce choix au démontage : RTA Fleet (retour stock, rechapage, hors
  service, rebut avec code motif obligatoire), Eptura (retour inventaire ou mise au rebut), OxMaint
  (kilométrage et motif relevés au démontage). Un pneu démonté qui disparaît du stock fausse
  l'inventaire du magasin.
- Limites assumées : le stock reste agrégé par référence (un pneu usagé remis en stock se mélange au
  neuf) ; le rechapage n'est pas modélisé ; les démontages antérieurs ne sont pas rattrapés.

**Preuve**
- Contrat `tires-rbac` 18/18 ; sur l'ancien code serveur, 4 rouges (stock non incrémenté, destination
  non exigée, PATCH générique accepté).
- Unitaire `tests/unit/shared/tire-removal.test.ts` (schéma, correspondance avec l'énumération) ;
  unitaire 478/478 ; `npm run check` 0 erreur.
- e2e `11-tire-removal-to-stock` vert : double clic = 1 requête, trame reçue par le magasinier,
  stock 0 → 1 en base.
- `client-payment-idempotence` (intégration) instable sans lien : 8/8 puis 2 échecs sur le même code,
  8/8 sans les changements pneus.

