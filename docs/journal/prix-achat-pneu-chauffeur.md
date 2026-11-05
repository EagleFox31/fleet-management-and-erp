# Prix d'achat des pneus : hors du périmètre du chauffeur

- Lecture : le chauffeur garde la fiche, la liste et le stock bas des pneus, sans `purchasePrice` (`server/lib/tire-price-scope.ts`, sur le modèle du prix de mission).
- Valeur d'inventaire (`/api/tires/statistics`, `/statistics-advanced`) : réservée au personnel hors chauffeur (`isTireValuationReader`).
- Temps réel : les trames `tire_*` partent au personnel hors chauffeur ; `vehicle_tire_*` (sans prix) restent au personnel.
- Écrans satellites vérifiés : aucun n'est piloté par `tire_*`. Le tableau de bord appelle `/api/tires/low-stock`, toujours servi au chauffeur.
- Garde : `tests/contract/tire-price-scope.contract.test.ts` (deux rôles, résolveur réel), trois mutations vues rouges.
- Correctif de relecture : la jointure des pneus montés (`GET /api/vehicles/:id/tires`, `getVehicleTires`) renvoyait la fiche pneu entière, prix compris, au chauffeur et au client propriétaire. Le masque est appliqué à la partie `tires` de chaque ligne seulement (un masque sur toute la réponse retirerait aussi le prix du véhicule, que le contrat véhicule veut présent à null). Le cas est couvert par le contrat (magasin, chauffeur, client propriétaire) et une mutation vue rouge.
- Les satellites n'avaient pas tous été vérifiés : les lectures entières de `tires` sont désormais gelées dans `tests/unit/server/tire-select-hygiene.test.ts` (sept occurrences, chacune justifiée ; toute nouvelle fait échouer le test).
- `isPlainObject` de `tire-price-scope.ts` accepte aussi les objets sans prototype, comme l'assistant véhicule.
- Leçon (relecture) : avant de changer un masquage, chercher les contrats existants sur la même route (grep du chemin dans `tests/contract`). `vehicle-purchase-price-scope.contract.test.ts` exigeait le prix du pneu visible sur `/vehicles/:id/tires` ; aligné (chauffeur et client : absent, catalogue : présent, prix véhicule inchangé à null).
