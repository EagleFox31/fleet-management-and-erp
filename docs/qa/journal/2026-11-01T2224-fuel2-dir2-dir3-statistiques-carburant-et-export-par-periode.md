## 2026-11-01 - FUEL2, DIR2, DIR3 : statistiques carburant et export par période

**Quoi**
- `tests/contract/fuel-vehicle-stats.contract.test.ts` : `GET /api/fuel-card/vehicle/:id/stats` (totaux, prix au litre, station la plus fréquente, enregistrements sans débit ignorés, autres véhicules ignorés, zéros, 401/403/400).
- `tests/contract/fuel-export-period.contract.test.ts` : export XLSX carburant filtré par mois et par année, contenu des cellules relu avec `xlsx`, 403 client, 400 année absente ou mois 13.
- `tests/support/contract-session.ts` : ajout de `raw()` pour lire un fichier binaire.

**Pourquoi**
- Plan : FUEL2, DIR2, DIR3 étaient « à faire ».

**Défauts figés (`it.fails`)**
- Statistiques d'un véhicule inconnu : 500 avec message brut au lieu de 404 (`fuel-card-service.ts:457`, route `fuel-card.routes.ts`).
- Un plein saisi par `POST /api/fuel-records` n'apparaît pas dans l'export de son mois : l'export filtre sur `fuelRecords.year/month` (`excel-export-service.ts:125`), que seul l'import Excel renseigne.

**Preuve**
- Rejeu sans `.fails` : rouge sur `expected [] to have a length of 1` (export) et sur 500 attendu 404 (statistiques).
- Relecture : le plein de l'export (véhicule, POST et son 201) est créé dans un `beforeAll`, le `it.fails` ne garde que le téléchargement et l'assertion. La date est fixe (2026-06-15) : le mois filtré est celui de la date envoyée, sans dépendre du fuseau ni du jour. Rouge rejoué sans `.fails` : `expected [] to have a length of 1 but got +0`. Contrat 4/4 verts.

**Limites**
- Rapports inventaire et performance technicien, historique de consommation : non couverts. FUEL1 et DIR1 non repris.

**Reste**
- FUEL1, DIR1, puis lot A5.

