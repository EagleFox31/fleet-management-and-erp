# Plan Subagent - Algo Budget Mission

## Objectif métier
Suggérer automatiquement un budget mission fiable et explicable:
- Budget carburant
- Budget frais de route (FDR)
- Budget imprévus
- Budget total

But: réduire les dépassements, limiter les sous-estimations, et accélérer la préparation de mission.

## Inputs minimaux (V1)
- `distance_km`
- `mission_type`
- `client_id`
- `destination`
- `vehicle_id` ou `vehicle_type`
- `fuel_unit_price`
- `pickup_date`
- `delivery_date`
- `weight_tons` (optionnel)
- `volume_m3` (optionnel)

Features dérivées V1:
- `duration_hours`
- `urgency_flag`
- `weekday`
- `month`

## Inputs enrichis (V2)
- Historique segmenté `(client, destination, mission_type, vehicle_type)`
- Consommation historique véhicule/chauffeur
- Retard moyen sur segment
- Saisonnalité
- Score qualité de données

## Stratégie algo
### Phase A (baseline explicable)
Formules métier simples:
- `fuel = distance * conso_ref(vehicle_type) * coeff_charge * fuel_unit_price * coeff_urgence`
- `fdr = tarif_destination + rate_km * distance + extras_fixes`
- `imprevu = max(5% * (fuel + fdr), reserve_min_segment)`
- `total = fuel + fdr + imprevu`

### Phase B (apprentissage progressif)
Modèles séparés `fuel` et `fdr` (quantiles P50/P80), puis fusion prudente:
- `fuel_final = max(fuel_baseline, fuel_p80)`
- `fdr_final = max(fdr_baseline, fdr_p80)`
- `imprevu_final = max(5%*(fuel_final+fdr_final), residual_p80)`

Fallback faible historique (`n < 30`):
- `70% baseline + 30% médiane historique segment`

## Garde-fous
- Si données critiques manquantes: pas de suggestion, message clair.
- Bornes min/max par segment.
- Alerte validation managériale si suggestion trop loin de la médiane segment.
- Monitoring dérive hebdomadaire (features + erreur).
- Rollback automatique vers baseline si dérive forte.

## Traçabilité & feedback utilisateur
Quand l’utilisateur remplace la suggestion:
- Conserver suggestion initiale
- Conserver valeur finale retenue
- Conserver motif de remplacement (obligatoire)
- Conserver auteur et date

Tables recommandées:
- `mission_budget_suggestions`
- `mission_budget_overrides`
- `mission_budget_outcomes`

## KPI de performance
- `WAPE fuel`, `WAPE fdr`, `WAPE total`
- `taux_depassement_budget`
- `coverage P80` (réel <= P80)
- `accept_rate` vs `override_rate`
- Latence scoring p95
- Part fallback vs part modèle

## Plan exécution (3 phases)
1. Baseline + API suggestion + UI accept/remplacer + stockage feedback.
2. Entraînement offline hebdo en shadow mode (comparaison baseline vs modèle).
3. Rollout progressif (10% -> 50% -> 100%) + monitoring dérive + rollback auto.

## Prompt prêt pour subagent
```
Conçois un algorithme de suggestion de budgets mission (carburant, FDR, imprévus) pour FleetMaster.
Contraintes:
- V1 explicable (règles métier) puis apprentissage progressif.
- Gérer données manquantes avec fallback robuste.
- Ajouter traçabilité complète des overrides utilisateur.
- Fournir schéma données, logique scoring, métriques de suivi, et plan d’implémentation en 3 phases.
Sortie attendue:
1) pseudo-code de calcul V1
2) design features V2
3) protocole d’évaluation offline + online
4) stratégie anti-dérive et rollback
5) proposition d’API d’inférence et payloads.
```
