# Decoupage PERT puis Sprint - Blocs Metiers Restants

Reference: `docs/planning/PLAN_BLOCS_METIERS_COUCHE_PAR_COUCHE.md`

## 1) PERT (ordre logique + dependances)

### Hypotheses
- Unite d'estimation: **jour ouvré**
- Formule PERT: **TE = (O + 4M + P) / 6**
- O = optimiste, M = probable, P = pessimiste
- Equipe cible: backend + frontend + QA en parallele

### WBS / Taches PERT

| ID | Tache | Depend de | O | M | P | TE |
|---|---|---|---:|---:|---:|---:|
| T00 | Cadrage final + contrat RBAC + events contract | - | 1 | 1.5 | 2 | 1.5 |
| T10 | Bloc A - Migrations BD (OT/pieces en attente) | T00 | 1 | 2 | 3 | 2.0 |
| T11 | Bloc A - Services + API workflow OT/pieces | T10 | 2 | 3.5 | 5 | 3.5 |
| T12 | Bloc A - UI OT detail + WS temps reel | T11 | 1.5 | 2.5 | 4 | 2.6 |
| T20 | Bloc B - Migrations BD (demande -> commande) | T11 | 1 | 2 | 3 | 2.0 |
| T21 | Bloc B - Services + API commande fournisseur | T20 | 2 | 4 | 6 | 4.0 |
| T22 | Bloc B - UI creation commande pre-remplie | T21 | 1.5 | 3 | 4.5 | 3.0 |
| T30 | Bloc C - Migrations BD facture/reglement | T21 | 1 | 2 | 3 | 2.0 |
| T31 | Bloc C - Services + API validation/reglement/rapprochement | T30 | 2 | 4 | 6 | 4.0 |
| T32 | Bloc C - UI facture fournisseur + preuve obligatoire | T31 | 2 | 3.5 | 5 | 3.5 |
| T50 | Bloc E - Socle audit/activity log + event bus standard | T00 | 1.5 | 2.5 | 4 | 2.6 |
| T51 | Bloc E - Cablage audit sur A/B/C + timeline unifiee | T12, T22, T32, T50 | 1.5 | 3 | 4.5 | 3.0 |
| T40 | Bloc D - Vues KPI + snapshots dashboard | T12, T22, T32 | 1.5 | 3 | 4.5 | 3.0 |
| T41 | Bloc D - API agregation dashboard + invalidation cache | T40 | 1.5 | 2.5 | 4 | 2.6 |
| T42 | Bloc D - Front dashboard (coherence cross-profils) | T41 | 2 | 3 | 4.5 | 3.1 |
| T60 | Stabilisation (QA E2E, perf, regressions, docs) | T42, T51 | 2 | 3.5 | 5.5 | 3.6 |

### Graphe PERT (texte)

`T00 -> T10 -> T11 -> T12 -> T20 -> T21 -> T22 -> T30 -> T31 -> T32 -> T40 -> T41 -> T42 -> T60`

Branche parallele:

`T00 -> T50 -> T51 -> T60`

avec dependance supplementaire:

`T12 + T22 + T32 -> T51`

### Chemin critique (estime)

Chemin critique principal:

`T00 -> T10 -> T11 -> T20 -> T21 -> T30 -> T31 -> T32 -> T40 -> T41 -> T42 -> T60`

Duree attendue approx du chemin critique: **~34.8 jours ouvres**  
(hors aleas env/devops/retours metier)

### Marges observees
- `T12` et `T22` ont une marge relative (non critiques si `T32` reste le plus long avant `T40`/`T51`).
- `T50` doit finir avant `T51`, mais n'est pas critique si termine avant la fin du lot C.

---

## 2) Conversion en Sprints (2 semaines / sprint)

## Sprint 1 - Bloc A fondation (OT + pieces en attente)
**Taches:** T00, T10, T11 (debut), T50 (debut)  
**Objectif:** rendre le workflow OT -> attente pieces fiable en BD/API.

### Livrables
- Migrations bloc A appliquees
- API creation attente pieces stable
- Events metier A emis
- Journal d'activite socle pose (premiere version)

### Profils impactes
- Technicien, Chef d'atelier, Magasinier, Admin

### Exit criteria
- Creation attente pieces sans incoherence de statut
- Evenement WS visible sur au moins 2 profils connectes

---

## Sprint 2 - Bloc A UI complet + demarrage Bloc B
**Taches:** T11 (fin), T12, T20, T21 (debut), T50 (fin)

### Livrables
- UI OT detail avec etats humains des pieces
- Bloc magasinier "OT bloques" actif
- Migrations bloc B en place
- Services conversion demande -> commande (MVP)

### Profils impactes
- Technicien, Chef d'atelier, Magasinier

### Exit criteria
- Pas de refresh manuel pour voir changement de statut OT
- Une demande approuvee peut ouvrir creation commande liee

---

## Sprint 3 - Bloc B complet (commande fournisseur)
**Taches:** T21 (fin), T22

### Livrables
- `/procurement/orders/new` pre-remplie (piece + demande + fournisseur historique)
- Quantites demandee/commandee/recue coherentement gerees
- Traçabilite "qui a envoye/confirmé/receptionné/cloturé"

### Profils impactes
- Magasinier, Secretaire, Admin

### Exit criteria
- Bouton "Passer la commande" exploitable de bout en bout
- Donnees preselectionnees visibles des l'ouverture de la page

---

## Sprint 4 - Bloc C complet (facture + reglement + rapprochement)
**Taches:** T30, T31, T32

### Livrables
- Statuts facture fournisseurs metier (pas de brut technique)
- Enregistrement reglement avec preuve obligatoire (image/PDF)
- KPI dette/paye/reste a payer expose via API + UI

### Profils impactes
- Secretaire (principal), Admin (backup), Magasinier (lecture/metier selon regles)

### Exit criteria
- Statut tableau facture coherent avec detail facture
- Bouton reglement disparait quand la facture est reglee

---

## Sprint 5 - Bloc D + Bloc E finalisation (dashboard + audit transversal)
**Taches:** T51, T40, T41, T42

### Livrables
- Dashboards coherents cross-profils (meme verite metier)
- Vues KPI metier en BD + API aggregation
- Timeline traçabilite unifiee (OT/commande/facture)

### Profils impactes
- Admin, Secretaire, Chef d'atelier, Magasinier, Technicien

### Exit criteria
- Plus de contradiction KPI dashboard vs page detail
- Toute transition metier visible sans reload

---

## Sprint 6 - Stabilisation transverse
**Taches:** T60

### Livrables
- QA E2E complet (scenario panne -> OT -> reappro -> commande -> facture -> reglement)
- Correctifs performance + charge
- Documentation fonctionnelle + checklist release

### Exit criteria
- E2E QA vert
- Aucun blocker P0/P1 ouvert

---

## 3) Checklist de pilotage par sprint

Pour chaque sprint, valider:
1. Migration + rollback testes
2. RBAC API et UI alignes
3. Evenements WS emis + consommes
4. Activity log present pour chaque transition cle
5. KPI et labels metier verifies par profil
6. Non-regression sur `routes.ts` (pas d'encombrement: modules `server/api/*.routes.ts`)

---

## 4) Risques majeurs et mitigation

| Risque | Impact | Mitigation |
|---|---|---|
| Drift entre statut BD et UI | Incoherence metier | Source unique + mapping statuts centralise |
| Changement visible seulement apres refresh | Mauvaise experience inter-profils | Event bus obligatoire + invalidation query ciblee |
| Regression sur autorisations | Risque operationnel | Matrice RBAC testee par role (API + UI) |
| Dette technique dans `routes.ts` | Evolution lente | Externaliser nouvelles routes par domaine |
| KPI lents/instables | Dashboard inexploitable | Vues/snapshots + index + refresh incremental |

---

## 5) Decision immediate proposee

Lancer **Sprint 1** sur le lot critique:  
`T00 + T10 + T11 + T50 (socle)`  
car c'est la base de coherence pour tous les ecrans et workflows en aval.

