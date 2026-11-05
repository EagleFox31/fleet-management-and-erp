# Prix d'achat des pneus : hors du périmètre du chauffeur

- Lecture : le chauffeur garde la fiche, la liste et le stock bas des pneus, sans `purchasePrice` (`server/lib/tire-price-scope.ts`, sur le modèle du prix de mission).
- Valeur d'inventaire (`/api/tires/statistics`, `/statistics-advanced`) : réservée au personnel hors chauffeur (`isTireValuationReader`).
- Temps réel : les trames `tire_*` partent au personnel hors chauffeur ; `vehicle_tire_*` (sans prix) restent au personnel.
- Écrans satellites vérifiés : aucun n'est piloté par `tire_*`. Le tableau de bord appelle `/api/tires/low-stock`, toujours servi au chauffeur.
- Garde : `tests/contract/tire-price-scope.contract.test.ts` (deux rôles, résolveur réel), trois mutations vues rouges.
