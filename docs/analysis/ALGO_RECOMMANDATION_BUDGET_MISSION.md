# Recommandation Budget Mission (Carburant, FDR, Imprevu)

## Sources metier utilisees (docs)
- `docs/qa/QA-DASHBOARD-ADMIN.md` : missionType, pickupDate/deliveryDate, weight, volume, estimatedDistance.
- `docs/planning/PLANIFICATION_MVP_COMPLETE.md` : couts reels vs estimes, tarifs FDR par destination, consommation moyenne par type vehicule, prix carburant.
- `docs/reports/RAPPORT_AVANCEMENT_PHASE1_FINALE_29_09_2025.md` : carte carburant credit/debit, month/year, unitPrice, balance/fuelBalance.
- `docs/reports/CORRESPONDANCE_LOT1_EXISTANT_EXCEL_29_09_2025.md` : formule conso x prix litre (828) + FDR variable par destination.

## 1) Variables d'entree
- Mission : `missionType`, `client`, `origin`, `destination`, `estimatedDistance`, `pickupDate`, `deliveryDate`, `weight`, `volume`.
- Ressource : `vehicleId`, type vehicule, conso moyenne vehicule.
- Prix/finance : `unitPrice` carburant (sinon valeur par defaut), tarif FDR destination, extras (ration/ligature/GPS).
- Historique : mediane couts reels missions similaires (client/destination/type/vehicule/mois), ecarts reel vs estime.
- Temps/saisonnalite : `month`, `year`, jour semaine.
- Disponibilite : solde carte carburant au moment du calcul (`balance`, `fuelBalance`).

## 2) V1 deterministe (simple)
Pseudo-formule :

```text
conso_est_l = distance_km
            * conso_ref_l_km(vehicle)
            * coef_charge(weight, volume)
            * coef_delai
            * coef_saison

budget_carburant = conso_est_l * prix_litre

budget_fdr = (tarif_fdr_destination
            + fdr_km * distance_km
            + extras_fixes)
            * coef_client
            * coef_delai
            * coef_saison

budget_imprevu = (budget_carburant + budget_fdr) * taux_risque
```

Regles simples:
- `taux_risque` = 5% base.
- 8% si longue distance.
- 10-12% si delai serre / route peu connue.

```text
budget_total = budget_carburant + budget_fdr + budget_imprevu
```

## 3) V2 data-driven (hybride)
- Entrainer 2 modeles sur missions cloturees :
  - modele A -> `actualFuelCost`
  - modele B -> `actualFdrCost`
- Features :
  - variables V1 + segment historique (client/destination/type/vehicule/mois) + solde carte.
- Sorties :
  - `P50`, `P75`, `P90` (quantiles).

Recommandation robuste :

```text
fuel_reco = max(V1_fuel, P75_fuel)
fdr_reco  = max(V1_fdr,  P75_fdr)
imprevu_reco = max(5% * (fuel_reco + fdr_reco), P90_residu_segment)
total_reco = fuel_reco + fdr_reco + imprevu_reco
```

Fallback faible historique :
- Si `n < seuil_segment`, utiliser `0.7 * V1 + 0.3 * mediane_historique`.

## 4) Garde-fous metier
- Blocage lancement mission si budget carburant non renseigne.
- Blocage (ou approbation manager) si `solde carte < budget_carburant`.
- Bornes min/max par destination et type mission.
- Alerte/validation si budget propose > `+30%` de la mediane des missions similaires.
- Exclure les anomalies de consommation du jeu d'apprentissage.
- Tracer tout override humain (motif + acteur + horodatage).

## 5) Champs a stocker en BD / workflowData
- Snapshot entree :
  - `missionType`, `clientId/clientName`, `origin`, `destination`, `estimatedDistance`,
  - `pickupDate`, `deliveryDate`, `weight`, `volume`, `vehicleId`,
  - `month`, `year`, `fuelUnitPrice`, `fuelCardBalanceAtCalc`.
- Sorties recommandation :
  - `recommendedFuelBudget`,
  - `recommendedFdrBudget`,
  - `recommendedContingencyBudget`,
  - `recommendedTotalBudget`.
- Explicabilite :
  - `coefficientsUsed` (charge/delai/saison/client),
  - `modelVersion`,
  - `confidenceScore`,
  - `fallbackUsed`.
- Workflow validation :
  - `approvalRequired`, `approvedBy`, `approvedAt`, `overrideReason`.
- Post-mission (boucle d'apprentissage) :
  - `actualFuelCost`, `actualFdrCost`, `actualOtherCost`, `actualTotalCost`,
  - `deltaFuel`, `deltaFdr`, `deltaTotal`.

## Suggestion implementation
- Ajouter une table dediee `mission_budget_recommendations` (historique complet).
- Garder aussi une copie compactee dans `missions.workflowData` pour lecture UI rapide.
