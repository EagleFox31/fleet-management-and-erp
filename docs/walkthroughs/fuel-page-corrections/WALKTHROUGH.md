# Walkthrough — Corrections page Carburant (`/fuel`)

**Date** : 2026-08-20  
**Périmètre** : données fausses, colonne Actions, ergonomie, KPI cliquables, accents FR  
**Référence métier** : `docs/plans/fuel-consumption-performance.md` (règle : jamais de chiffre inventé)

---

## 1. État avant

### 1.1 Données fausses ou trompeuses

| Problème | Symptôme UI | Cause code |
|---|---|---|
| Kilométrage « 0 km » | Tableau pleins affichait `0 km` | `(row.mileage \|\| 0).toLocaleString()` — `fuel_records.mileage` est **nullable** |
| Consommation sur-estimée | L/100 km trop élevé (+50 à +100 %) | `totalFuel` incluait **tous** les pleins ; `totalDistance` seulement les intervalles |
| Explosion silencieuse | Consommation absurde si km manquant au milieu | `prevMileage \|\| 0` comptait toute la distance depuis 0 |
| Message vague | « Calcul impossible » sans explication | Aucune raison métier exposée |
| Performance | Re-calcul à chaque rendu O(n²) | `sortedRecords.slice(0, index).filter(...)` par ligne |

### 1.2 Colonne Actions inutile

- Bouton **œil** → même URL que `onRowClick` sur la ligne (`/fuel/:id`).
- Bouton **Vehicule** → triple accès au même véhicule (immatriculation, carte consommation, bouton).
- Les routes API **PATCH** / **DELETE** existaient (`server/routes.ts` ~3469 / ~3543) mais n'étaient pas exposées dans le tableau.

### 1.3 Ergonomie

- Section « Consommation par véhicule » en **grille 3 colonnes** : 2/3 d'écran vide avec un seul camion ; tableau historique repoussé sous la ligne de flottaison.
- Bulle mascotte (`MascotHelper`, `bottom-right`) recouvrait la colonne Actions.
- Accents FR manquants (`Vehicule`, `Cout`, `Kilometrage`, …).
- En-tête colonne **Type** peu lisible vs **Plein** (Complet / Partiel).
- `KpiTile` statique — pas de clic vers l'historique filtré / recharges carte.

---

## 2. Modifications réalisées

### 2.1 Lib partagée `client/src/lib/fuel-consumption.ts`

Nouvelle source unique pour le calcul **plein à plein** :

- Premier plein = repère kilométrique uniquement (carburant exclu du numérateur).
- Intervalle `i` : carburant = `quantity` du plein `i`, distance = `mileage[i] - mileage[i-1]`.
- Intervalles ignorés si km absent sur **l'un des deux pleins consécutifs** — **jamais** traité comme 0, **pas de chaînage** au-delà d'un plein invalide (évite les distances fantômes).
- Messages explicites :
  - `Un seul plein enregistré, il en faut deux`
  - `Kilométrage non renseigné sur les pleins`
  - `Distance parcourue non calculable entre les pleins`
- Agrégation par véhicule en O(n log n) (tri + une passe), sans re-filtrage quadratique.

### 2.2 Page `client/src/pages/fuel/index.tsx`

| Zone | Changement |
|---|---|
| Tableau pleins | Kilométrage → `N/A` si null ; colonne **Plein** ; accents corrigés |
| Actions | **Modifier** (admin ou auteur) + **Supprimer** (admin / chef d'atelier) ; suppression œil + Vehicule |
| Dialogues | Édition inline (`FuelRecordForm` PATCH) ; confirmation suppression (DELETE) |
| Consommation | Grille cards → **`PremiumDataTable`** compact ; lien immatriculation vers fiche véhicule |
| Affichage conso | `Non calculable` + sous-texte raison (via `formatConsumptionDisplay`) |
| KPI | `KpiTile` cliquable : Pleins → onglet historique ; Solde carte → onglet recharges |
| Mascotte | `pb-20 pr-2` sur zone table pour éviter le chevauchement |

### 2.3 Composant `client/src/components/design-system/kpi-tile.tsx`

- Prop `onClick` optionnelle.
- Curseur pointer, hover, `role="button"`, clavier Entrée/Espace — aligné sur `DeadlineTile`.

---

## 3. État en sortie

### 3.1 Comportement attendu

```
Pleins véhicule A :
  P1 : 100 000 km, 400 L  → repère
  P2 : 101 000 km, 350 L  → 350 L / 1 000 km = 35,0 L/100 km

Tableau pleins :
  km absent     → N/A (pas 0 km)
  clic ligne    → détail plein
  Modifier      → dialog PATCH
  Supprimer     → DELETE (RBAC atelier)

Consommation :
  1 seul plein  → Non calculable · Un seul plein enregistré, il en faut deux
  km manquant   → Non calculable · Kilométrage non renseigné sur les pleins

KPI :
  Pleins enregistrés (clic) → scroll historique pleins
  Solde carte (clic)        → scroll historique recharges
```

### 3.2 Intégration avec le reste de l'application

| Module | Lien |
|---|---|
| `FuelRecordForm` | Réutilisé pour création (dialog existant) et édition (nouveau dialog liste) |
| `PATCH /api/fuel-records/:id` | Déclenche mise à jour km véhicule + maintenance préventive si km augmente |
| `DELETE /api/fuel-records/:id` | Middleware `isWorkshopManager` — UI masque le bouton aux autres rôles |
| Fiche mission | Logique consommation mission (`missions/[id].tsx`) inchangée — même philosophie « pas de chiffre inventé » |
| `queryClient` | Invalidation `/api/fuel-records` + `/api/fuel-records/statistics` après edit/delete |

---

## 4. Preuves de fonctionnement

### 4.1 Tests unitaires (Vitest)

Fichier : `test/fuel-consumption.test.ts`

```bash
npm test -- test/fuel-consumption.test.ts
```

| Test | Vérifie |
|---|---|
| Exclut carburant du 1er plein | Pas de sur-estimation +100 % (350 L / 1 000 km = 35 L/100 km) |
| Un seul plein | Message « il en faut deux » |
| Km intermédiaire null | Intervalle ignoré, pas d'explosion depuis 0 |
| Km absent entre deux pleins éloignés | `totalDistance = 0`, raison explicite |
| Plusieurs intervalles | Cumul correct sur 2 intervalles |
| Agrégation multi-véhicules | Regroupement sans O(n²) |
| `formatConsumptionDisplay` | Format FR + détail raison |
| Affichage km null | `N/A` ≠ `0 km` |

**Résultat attendu** : suite verte (10 tests).

### 4.2 Vérification TypeScript

```bash
npm run check
```

Les 2 erreurs préexistantes (`interventions.tsx`, `parts-service.ts`) restent hors périmètre ; aucune nouvelle erreur sur les fichiers modifiés.

### 4.3 Scénarios manuels recommandés (QA)

1. **Km null** : créer un plein sans kilométrage → colonne affiche `N/A`.
2. **Consommation** : 2 pleins même véhicule avec km → L/100 km cohérent ; 1 seul plein → message explicite.
3. **Actions** : clic ligne ouvre détail ; Modifier ouvre formulaire ; Supprimer réservé admin / chef d'atelier.
4. **KPI** : clic « Pleins enregistrés » scroll vers le tableau ; « Solde carte » bascule onglet recharges.
5. **Mascotte** : colonne Actions visible sans chevauchement (écran 15").

### 4.4 Non réalisé dans ce lot (hors scope demandé)

- Jauge réservoir / niveau actuel (données absentes en BDD — voir contexte utilisateur).
- Télémétrie CAN/GPS.
- Tests e2e Playwright dédiés `/fuel` (à ajouter si besoin CI).

---

## 5. Fichiers touchés

```
client/src/lib/fuel-consumption.ts          (nouveau)
client/src/pages/fuel/index.tsx             (refonte)
client/src/components/design-system/kpi-tile.tsx
test/fuel-consumption.test.ts               (nouveau)
docs/walkthroughs/fuel-page-corrections/WALKTHROUGH.md
```

---

## 6. Ordre de priorité appliqué

1. **Données** — calcul consommation + km N/A  
2. **UI rapide** — Actions, accents, en-tête Plein, marge mascotte  
3. **Améliorations** — tableau consommation, KPI cliquables  
