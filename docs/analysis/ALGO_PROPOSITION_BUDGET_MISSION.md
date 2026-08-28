# Algorithme Proposition Budgets Mission

## Objectif
Proposer automatiquement:
- Budget carburant
- Budget frais de route (FDR)
- Budget imprévus

pour préremplir la mission avant lancement.

## Entrées minimales (V1)
- Distance estimée (km)
- Type mission (`livraison`, `récupération`, `aller-retour`)
- Poids / volume cargo
- Véhicule affecté (conso estimée L/100km)
- Prix litre carburant (config système)
- Niveau d'urgence / retard au départ
- Client (historique surcoûts éventuels)

## Calcul V1 (déterministe)
1. Carburant:
`litres_estimes = distance_km * conso_l_100 / 100`
`budget_carburant = litres_estimes * prix_litre`

2. FDR:
`budget_fdr = forfait_type_mission + (distance_km * tarif_fdr_km)`

3. Imprévus:
`budget_imprevu = (budget_carburant + budget_fdr) * taux_risque`

4. Coefficients:
- Retard élevé: +5% à +15%
- Client “complexe” (zones portuaires, délais contraints): +5%
- Charge lourde proche tonnage max: +5%

## Sortie
- `fuelBudget`
- `roadExpensesBudget`
- `contingencyBudget`
- `totalBudget = fuel + fdr + imprevu`
- `confidence`: `low | medium | high` (selon qualité des données)

## Traçabilité à stocker
Dans `missions.workflowData.budgetRecommendation`:
- version algorithme
- inputs utilisés
- coefficients appliqués
- budgets proposés
- utilisateur ayant validé / modifié

## Évolution V2
- Ajustement statistique par historique réel:
  - erreur moyenne par client
  - erreur moyenne par axe logistique
  - quantiles (P50/P90) pour budget prudent
- Alerte si budget saisi < proposition minimale.
