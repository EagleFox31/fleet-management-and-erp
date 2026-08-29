# Chantier — Profil Direction (`management`)

> Dashboard exécutif pour le DG : **CA facturé** et **résultat après charges** séparés, lecture seule, sans impact sur les autres profils.

Dernière mise à jour : août 2026

---

## Objectif

Un profil **`management`** (libellé UI : **Direction**) avec un écran unique, simple :

| Pilier | Question DG |
|---|---|
| Flotte | Combien de camions sont opérationnels ? |
| Entrées | CA facturé, encaissé, impayés |
| Sorties | Carburant, maintenance, achats fournisseurs |
| Résultat | Marge brute (HT) après charges directes |
| Rentabilité | Top clients, top destinations / lignes |

**Hors périmètre MVP** : saisie, admin utilisateurs, stock, OT, drill-down opérationnel.

**Mon équipe** (`/management/team`) : effectifs par pôle (exploitation, atelier, magasin), conducteurs terrain et **points d'action** pour le DG — pas de détail RH opérationnel ni scorecard technique.

---

## Architecture (dossier dédié)

```
client/src/pages/management/          # Pages Direction uniquement
client/src/components/management/     # Composants Direction uniquement
server/services/management-dashboard-service.ts
server/api/management.routes.ts       # GET /api/management/dashboard
shared/constants/management-dashboard.ts
```

Réutilisation design system : `HeaderCard`, `KpiGrid`, `KpiTile`, `CardShell`, `StatusMetricStrip`, `PremiumTabsNav`, `ClientRevenueChart` (inspiration).

---

## Suivi

### Phase 0 — Cadrage & doc

- [x] Rédiger ce document de chantier
- [x] Benchmark concurrence / attentes DG (voir conversation août 2026)

### Phase 1 — Backend agrégateur

- [x] Ajouter le rôle `management` dans `shared/schema.ts`
- [x] Constantes partagées période + types réponse (`shared/constants/management-dashboard.ts`)
- [x] Service `management-dashboard-service.ts` (CA HT/TTC, charges, marge, flotte, tops)
- [x] Route `GET /api/management/dashboard?period=month` (lecture seule, rôles `management` + `admin`)
- [x] Middleware `isManagementOrAdmin`
- [x] Monter le routeur dans `server/api/index.ts`

### Phase 2 — Frontend Direction (isolé)

- [x] Page `client/src/pages/management/dashboard.tsx`
- [x] Composants `components/management/` (flux argent, tops, sélecteur période)
- [x] Branchement `App.tsx` : `SmartDashboardRoute` case `management`
- [x] Menu sidebar minimal (2 entrées : dashboard + rapports)
- [x] Libellés rôle (`contextual-help/roles.ts`, `topnav`, admin users)

### Phase 3 — Compte & QA

- [x] Documenter création compte DG dans `docs/qa/COMPTES_ENVIRONNEMENT.md`
- [ ] Test manuel : login Direction → dashboard sans menu admin
  *(à faire par un humain: se connecter et regarder. Aucun agent ne peut
  cocher cette case.)*
- [ ] Test régression : technicien / magasinier inchangés
  *(⚠️ Ces deux écrans **ont été modifiés** le 2026-08-29, commit `308b2c1`:
  ajout de la tuile mise en avant, sur demande explicite. La règle de
  non-régression n°1 est donc levée pour ce point. `tsc` vert et tests
  unitaires verts n'établissent de toute façon pas qu'un écran est inchangé:
  aucune assertion ne porte sur ces pages.)*
- [x] Tests unitaires période management (`tests/unit/shared/management-dashboard.test.ts`)

### Phase 4 — V2 (non MVP)

- [x] Rentabilité par type de marchandise (`missions.cargo`)
- [x] Comparaison période N vs N-1 (flèches tendance)
- [x] Export PDF « rapport Direction » mensuel
- [x] Page `/management/reports` dédiée

### Phase 5 — Performance Direction

- [x] Benchmark : plancher ~475 ms = latence Neon (année ≈ semaine en temps)
- [x] **Décision** : cache SQL retiré (complexité sans gain mesurable à ce volume)
- [x] Index dates conservés (`client_invoices`, `fuel_records`, `supplier_invoices`, `missions`, `work_orders`)
- [x] Test intégration HT sur le service (`tests/integration/management-dashboard-service.test.ts`)
- [ ] Si lenteur perçue : cache client React Query staleTime, ou région Neon plus proche

### Phase 6 — Évolutions Stratégiques DG (Roadmap Inspirée Benchmark)

- [x] **Prix de Revient Kilométrique (PRK) en direct** :
  - Formule : $\text{PRK} = \frac{\text{Carburant + OT + factures fournisseurs HT}}{\Sigma \text{actual\_distance}}$
  - Pneus comptés à l'achat (facture fournisseur), pas via `tire_rotations.cost`.
  - Missions sans km réel exclues du dénominateur mais signalées dans l'UI.
- [x] **Coût de Maintenance par Kilomètre (CPK Maintenance)** :
  - Formule : $\text{CPK Maintenance} = \frac{\Sigma \text{Coûts OT terminés} + \text{Pneumatiques}}{\text{Total Km réels}}$
  - Affiché avec le PRK sur le même panneau Direction.
- [x] **Durée Moyenne d'Immobilisation Flotte (Downtime Atelier)** :
  - Calcul automatique du temps moyen d'arrêt des camions (heures cumulées et moyenne / OT clôturé).
  - Alerte de gouvernance si un véhicule clé reste immobilisé $> 48\text{ h}$ (`vehiclesImmobilizedOver48h`).
- [x] **Rentabilité Unitaire par Mission (*Cost/Profit per Job*)** :
  - Formule : $\text{Marge Mission HT} = \text{CA facturé HT} - (\text{Carburant réel} + \text{FDR réels} + \text{CPK} \times \text{km réels})$.
  - Onglet **Rentabilité** : top missions rentables + missions déficitaires, données incomplètes signalées.
  - FDR réels via `workflowData.costs.actualFdrCost` — saisie obligatoire à la clôture (0 autorisé), budget exclu.
  - Périmètre affiché : marge directe mission vs résultat brut global (achats fournisseurs non rattachés, allocation CPK).
- [x] **FDR dans les charges globales Direction** :
  - Les FDR réels missions alimentent `expenses.roadExpenses` et le résultat brut (HT).
  - Détail visible dans l'onglet **Flux d'argent** et le PDF Direction.
- [x] **TCO (Total Cost of Ownership) par Véhicule** :
  - Coûts période (carburant + maintenance atelier) vs CA HT attribué via affectations mission.
  - Assurances flotte agrégées (factures fournisseur catégorie assurance) — non ventilées par véhicule.
  - Prix d'acquisition en référence patrimoniale ; panneau sur l'onglet **Indicateurs**.
- [x] **Scorecard Chauffeur & Éco-conduite** :
  - Note composite /100 : consommation L/100 km (40 %), ponctualité livraison (40 %), incidents (20 %).
  - Médiane flotte, top performers et chauffeurs à surveiller — onglet **Indicateurs**.
  - Incidents via alertes `[Mission …]` ; tolérance ponctualité 4 h corridor.
- [x] **Indice de Vétusté & Recommandation de Remplacement d'Actif** :
  - Amortissement linéaire 10 ans ; maintenance annualisée vs valeur résiduelle.
  - Liste des candidats au remplacement — onglet **Indicateurs** + PDF.
- [x] **Cartographie Exécutive des Corridors CEMAC** :
  - Intégrée sur l'onglet **Vue d'ensemble** du dashboard Direction.
  - Carte interactive *CartoDB Dark Matter* avec tracés des 4 corridors CEMAC, hubs logistiques, camions en direct pulsants, filtres rapides et panneau d'inspection latérale.

---

## Règles de non-régression

1. **Ne pas modifier** les dashboards admin, secrétaire, logistique, etc.
2. Toute logique Direction vit dans `pages/management/` et `components/management/`.
3. Les autres profils ne voient pas le menu Direction.
4. L’API `/api/management/*` est protégée ; les APIs existantes restent inchangées.

---

## Formules Exécutives Direction

**Règle de cohérence** : le résultat brut est calculé **tout en HT**. Mélanger CA HT
et charges TTC fausse la marge (~19,25 % du volume d'achats fournisseurs compté
à tort comme charge).

| Métrique | Source | Base |
|---|---|---|
| CA facturé (affichage TTC) | `client_invoices.amount_ttc` | TTC |
| CA pour marge | `client_invoices.amount_ht` | **HT** |
| Encaissé | TTC − `balance` | TTC |
| Impayés | Σ `balance` | TTC |
| Charge carburant | Σ `fuel_records.debit_amount` ou `cost` | HT* |
| Charge maintenance | Σ `work_orders.cost` (OT terminés) | HT |
| Charge fournisseurs | Σ `supplier_invoices.amount_ht` | **HT** |
| Résultat brut | CA HT − (carburant + maintenance + fournisseurs) | **HT** |
| PRK (Prix de Revient Km) | (Carburant + maintenance + fournisseurs HT) / Σ `actual_distance` missions | **HT / km réel** — pneus à l'achat fournisseur, pas `tire_rotations.cost` |
| CPK Maintenance | (Coûts OT + achats pneus fournisseur cat. `Pneus`) / Σ `actual_distance` | **HT / km réel** — filtre via `supplier-categories.ts` |
| Rentabilité Mission | CA mission HT − (carburant réel + FDR réels + CPK × km réels) | **HT / mission** — FDR réels uniquement |
| TCO Véhicule | Achat + Σ Carburant + Σ Maintenance + Σ Assurances | **HT / véhicule** |
| Flotte & Disponibilité | `vehicleStatusService.getFleetStatistics()` | — |

\* Carburant : pas de double comptage avec les pièces OT — les pièces passent par
`work_orders.cost`, le carburant par `fuel_records` uniquement.

---

## Post-mortem (août 2026)

| # | Problème | Gravité | Correction |
|---|---|---|---|
| 01 | Marge DG : charges fournisseurs TTC soustraites d'un CA HT | Critique | `supplier_invoices.amount_ht` |
| 02 | Quatre listes de rôles divergentes | Élevée | `AppRole` + `ALL_APP_ROLES` dérivés du schéma (`shared/constants/roles.ts`) |
| 03 | `ClientDashboard` appelé sans import dans `App.tsx` | Élevée | Import ajouté |
| 04 | Perte affichée en vert (`featured` neutralise `valueClassName`) | Moyenne | `featuredTone="danger"` sur la tuile Résultat brut |
| 05 | Soupçons carburant / pièces | Info | Vérifiés, commentaires seulement |

**Leçons** : lancer `npm run check` sur **tout** le projet (pas de filtre sur ses
fichiers) ; relire les formules des docs cochées « fait » ; dériver, ne pas recopier.

---

## Compte test (à créer via Admin > Utilisateurs)

| Rôle | Login suggéré | Mot de passe |
|---|---|---|
| Direction (`management`) | `dg` | *(défini à la création)* |
