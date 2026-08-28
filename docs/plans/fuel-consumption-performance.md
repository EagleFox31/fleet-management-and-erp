# Plan : Performance de consommation carburant

**Statut** : Décisions à trancher — non implémenté
**Date** : 2026-08-20
**Priorité** : Moyenne — pilotage technique de la flotte

---

## Ne pas confondre avec le suivi financier

`docs/plans/fuel-mission-tracking.md` traite **l'argent** : budget prévisionnel
contre coût réel, anti double-déduction sur la carte carburant, intégrité des
totaux mission. Il est **déjà implémenté** malgré son statut affiché :
`fuel_records.mission_id`, l'index et le trigger `sync_mission_fuel_totals`
existent en base (vérifié le 2026-08-20).

Le présent plan traite **la technique** : combien ce camion consomme, et est-ce
que ça se dégrade. Les deux axes sont complémentaires et ne partagent que la
table `fuel_records`.

---

## Problème

Rien ne permet aujourd'hui de répondre à : *« ce camion consomme-t-il plus
qu'avant ? »*

Une dérive de consommation est pourtant le signal avancé le moins cher à
collecter pour détecter un moteur qui fatigue, une pression de pneus
insuffisante, ou une conduite coûteuse. Sans référence, une hausse passe
inaperçue jusqu'à la panne.

---

## Ce qui existe déjà

| Donnée | Table | État |
|---|---|---|
| `actualFuelQuantity` (litres consommés) | `missions` | ✅ alimenté par trigger |
| `actualDistance` (km réels) | `missions` | ✅ saisi |
| `estimatedDistance` | `missions` | ✅ saisi |
| `quantity` (litres par plein) | `fuel_records` | ✅ |
| `fullTank` (plein complet oui/non) | `fuel_records` | ✅ |
| `mileage` au plein | `fuel_records` | ⚠️ **nullable** — « pas toujours disponible » |

**Conséquence immédiate** : la consommation par mission est calculable
*aujourd'hui*, sans migration :

```
consommation (L/100 km) = actualFuelQuantity / actualDistance × 100
```

C'est le point de départ livré (voir « Étape 0 » ci-dessous).

## Ce qui manque

| Donnée | Pourquoi |
|---|---|
| `vehicles.tankCapacity` | Contenance du réservoir — nécessaire à toute jauge |
| `vehicles.referenceConsumption` | La consommation « à neuf », sans laquelle aucune dérive n'est mesurable |
| Niveau au départ / à l'arrivée | Si on retient la méthode par niveau déclaré |

---

## Décisions métier à trancher avant tout développement

### 1. Comment mesurer la consommation d'une mission ?

**Option A — Plein à plein.** On fait le plein au départ et à l'arrivée ; le
second plein *est* la consommation. C'est la méthode de référence du métier.
`fullTank` existe déjà, aucun champ à ajouter.
*Contrainte* : discipline de saisie, et un kilométrage fiable à chaque plein.

**Option B — Niveau déclaré.** Le chauffeur saisit le niveau au départ et à
l'arrivée depuis la PWA. Plus souple, pas besoin de faire le plein.
*Contrainte* : deux champs sur `missions`, un sur `vehicles`, et la précision
dépend de la lecture de jauge du chauffeur.

**Recommandation** : commencer par **A**, qui ne coûte aucune migration, et
n'ouvrir B que si la discipline « plein à plein » ne s'installe pas sur le
terrain.

### 2. Litres ou pourcentage ?

Si option B : le pourcentage est plus facile à lire sur un tableau de bord de
camion, mais impose de connaître `tankCapacity` pour le convertir. Les litres
sont exploitables directement. **Recommandation : litres**, avec la contenance
affichée à côté.

### 3. D'où vient la référence « à neuf » ?

- **Donnée constructeur** saisie à la création du véhicule : disponible tout de
  suite, mais théorique et souvent optimiste.
- **Moyenne mesurée** sur les N premières missions valides : réaliste, reflète
  l'usage réel, mais indisponible tant que N n'est pas atteint.

**Recommandation** : la moyenne mesurée sur les **10 premières missions
valides**, avec repli sur la donnée constructeur tant que le seuil n'est pas
atteint. C'est la logique de repli déjà retenue dans
`docs/analysis/ALGO_RECOMMANDATION_BUDGET_MISSION.md`.

### 4. Que faire des missions incomplètes ?

Une mission sans `actualDistance`, sans `actualFuelQuantity`, ou avec une
distance nulle **ne doit pas entrer** dans le calcul — elle produirait une
division par zéro ou une moyenne fausse.

Même règle que celle déjà écrite pour l'algorithme budget : *« exclure les
anomalies de consommation du jeu d'apprentissage »*.

À trancher : les signale-t-on à l'utilisateur (« 3 missions exclues faute de
kilométrage ») ou les ignore-t-on en silence ? **Recommandation : les
signaler** — sinon un taux calculé sur 2 missions sur 20 paraît fiable.

---

## Étape 0 — Livrée : consommation par mission

Aucune migration. Calcul dérivé de l'existant, affiché sur le détail mission.

- Tuile « Consommation » : `L/100 km` + litres et kilomètres qui la composent
- État neutre explicite quand la donnée manque, jamais un chiffre inventé

C'est le socle : il rend la donnée visible et permet de vérifier sa qualité
avant d'investir dans les sprints suivants.

---

## Sprint 1 — Référence véhicule et dérive

1. `vehicles.referenceConsumption` (numeric, nullable) + champ au formulaire
   véhicule, section Technique.
2. Service : `getVehicleConsumptionStats(vehicleId)` renvoyant
   `{ reference, moyenne30j, moyenneGlobale, derivePourcent, missionsRetenues,
   missionsExclues }`.
3. Tuile de dérive sur le détail véhicule, réutilisant `KpiStatus` :
   `success` sous +5 %, `warning` de +5 à +15 %, `critical` au-delà.
4. Alerte `procurement`… non : type `maintenance`, destinataires
   `admin` + `workshop_manager`, déclenchée par `alertService` quand la dérive
   dépasse le seuil critique sur 3 missions consécutives.

## Sprint 2 — Historique et comparaison de flotte

1. Courbe de consommation par véhicule dans l'onglet « Santé du véhicule ».
2. Classement des véhicules par écart à leur propre référence — pas entre eux :
   un porteur et un tracteur ne se comparent pas.
3. Export Excel de la consommation par véhicule et par mois.

## Sprint 3 — Niveau au départ / arrivée (si option B retenue)

1. `vehicles.tankCapacity`, `missions.fuelLevelStart`, `missions.fuelLevelEnd`.
2. Saisie dans la PWA chauffeur au démarrage et à la clôture de mission.
3. Jauge sur le détail mission, et recoupement avec les pleins enregistrés
   (un écart signale une saisie erronée ou un siphonnage).

---

## Points de vigilance

1. **Ne jamais afficher un chiffre inventé.** Sans distance réelle, la tuile
   affiche « Non calculable », pas une estimation. Un chiffre faux sur un
   tableau de bord est pire qu'une case vide — un logisticien y prend des
   décisions.
2. **`fuel_records.mileage` est nullable.** Toute méthode qui s'appuie dessus
   doit gérer l'absence explicitement.
3. **Comparer un véhicule à lui-même**, jamais à la flotte : le type, la charge
   et les axes parcourus rendent la comparaison inter-véhicules trompeuse.
4. **La saisie du kilométrage réel est le maillon faible.** Aucun raffinement de
   calcul ne compensera des `actualDistance` non renseignés. Si l'adoption est
   mauvaise, le sujet est la saisie, pas l'algorithme.
5. **Seuils partagés.** Réutiliser `KpiStatus` et `statusFromDeadline` de
   `client/src/lib/kpi-status.ts` plutôt que de redéfinir des paliers locaux —
   le projet a déjà payé cher la multiplication des sources de vérité.

---

## Fichiers concernés

| Fichier | Sprint |
|---|---|
| `client/src/pages/missions/[id].tsx` | Étape 0 ✅ |
| `shared/schema.ts` | 1, 3 |
| `server/init-database.ts` | 1, 3 |
| `server/services/fuel-service.ts` | 1 |
| `client/src/components/vehicles/vehicle-form.tsx` | 1 |
| `client/src/pages/vehicles/[id].tsx` | 1, 2 |
| `server/services/alert-service.ts` | 1 |
| `client/src/pages/driver/dashboard.tsx` | 3 |
