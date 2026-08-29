# QA Dashboard Administrateur — Parcours inter-profils avec ordre de dépendances métier

> FleetMaster 2.0
> Version orientée processus métier multi-acteurs (Admin, Technicien, Magasinier, Logisticien, Secrétaire, etc.)
> Les utilisateurs sont déjà créés.

---

## Objectif

Valider le dashboard administrateur avec des données issues de vrais enchaînements métier entre profils.

Ce plan remplace l'ancien mode "tests indépendants par composant".

---

## Prérequis

| # | Condition |
|---|-----------|
| P1 | Application démarrée (`npm run dev`) sur `http://localhost:5000` |
| P2 | Base de données connectée et schéma à jour (`npm run db:push`) |
| P3 | Comptes utilisateurs déjà disponibles par rôle — voir tableau ci-dessous |
| P4 | Ne pas réinitialiser la base entre les parcours P0 → P7 |

### Comptes environnement Neon (logins réels)

> Référence complète : `docs/qa/COMPTES_ENVIRONNEMENT.md`

| Rôle métier | Login | Nom affiché |
|-------------|-------|-------------|
| Admin | `admin` | Administrateur Système |
| Chef d'atelier | `terry` | Terry Koulibaly |
| Technicien | `ali` | Ali Sawadogo |
| Secrétaire | `dana` | Dana Del Rey |
| Logisticien | `issouf` | Issouf Coulibaly |
| Magasinier | `fatou` | Fatoumata Diallo |
| Chauffeur | `jean.mballa` | Jean Mballa |

Mots de passe documentés : voir **`docs/qa/COMPTES_ENVIRONNEMENT.md`** (tous les comptes QA sont à jour).

---

## Suivi d'exécution

> Mettre à jour **cette table** au fil de la campagne : c'est le seul endroit à
> lire pour savoir où on en est. Chaque parcours porte aussi son propre marqueur
> d'état juste sous son titre.
>
> États : `À faire` · `En cours` · `✅ Fait` · `⚠️ Fait avec réserve` · `❌ Bloqué`

| Parcours | État | Date | Testeur | Remarques |
|---|---|---|---|---|
| P0 — Contrôle d'accès par rôle | ✅ Fait | | | |
| P1 — Référentiel de base | ✅ Fait | | | |
| P2 — Maintenance inter-profils | En cours | | | |
| P3 — Réapprovisionnement inter-profils | À faire | | | |
| P4 — Opérations inter-profils | À faire | | | |
| P5 — Conformité documentaire | À faire | | | |
| P5b — Cycle de vie des pneus | À faire | | | |
| P5c — Carburant et carte rechargeable | À faire | | | |
| P5d — Renouvellement de documents | À faire | | | |
| P5e — Catalogue des pannes | À faire | | | |
| P6 — Connexions et activité récente | À faire | | | |
| P7 — Consolidation dashboard + export | À faire | | | |

### Anomalies relevées

| ID | Parcours | Gravité | Description | État |
|---|---|---|---|---|
| | | | | |

---

## Ordre d'exécution obligatoire

| Ordre | Parcours | Dépend de |
|------|----------|-----------|
| P0 | Contrôle d'accès par rôle | — |
| P1 | Référentiel de base (véhicules, pièces, fournisseurs, clients) | P0 |
| P2 | Maintenance inter-profils (WO + pièces) | P1 |
| P3 | Réapprovisionnement inter-profils (demande → commande → facture fournisseur) | P2 |
| P4 | Opérations inter-profils (mission → facture client → paiement) | P1 |
| P5 | Conformité documentaire (docs véhicules + CPC chauffeurs) | P1 |
| P5b | Cycle de vie des pneus (montage → inspection → rotation → démontage) | P1 |
| P5c | Carburant et carte rechargeable | P1, P4 |
| P5d | Renouvellement de documents véhicules | P1, P5 |
| P5e | Catalogue des pannes | P1 |
| P6 | Connexions utilisateurs et activité récente | P2 à P5e |
| P7 | Consolidation dashboard admin + export mensuel | P2 à P6 |

> Les parcours `P5b` à `P5e` sont numérotés ainsi pour rester **avant** la
> consolidation : P6 et P7 doivent voir leurs données. Ne pas les déplacer
> après P7.
>
> Le **pointage** (`time_tracking`, `monthly_time_stats`) n'a pas de parcours :
> aucune API ne l'expose. Voir la section « Hors périmètre » en fin de document.

---

## P0 — Contrôle d'accès par rôle

**État : ✅ Fait**

**But :** vérifier que les profils non-admin ne peuvent pas accéder à `/admin/dashboard`.

| Étape | Profil connecté | Action | Résultat attendu |
|------|------------------|--------|------------------|
| 1 | Technicien | Se connecter puis ouvrir `/admin/dashboard` | Refus d'accès (message rouge) ou redirection vers dashboard technicien |
| 2 | Magasinier | Même action | Refus d'accès ou redirection |
| 3 | Logisticien | Même action | Refus d'accès ou redirection |
| 4 | Secrétaire | Même action | Refus d'accès ou redirection |
| 5 | Admin | Ouvrir `/admin/dashboard` | Accès autorisé |

---

## P1 — Référentiel de base

**État : ✅ Fait**

**But :** préparer les objets de référence qui alimenteront les parcours métiers.

| Étape | Profil connecté | Action | Résultat attendu |
|------|------------------|--------|------------------|
| 1 | Admin | Créer 2 véhicules actifs + 1 véhicule en maintenance | Référentiel flotte prêt |
| 2 | Admin ou Magasinier | Créer 3 pièces stockées (`/inventory`) | Référentiel pièces prêt |
| 2b | Admin puis Magasinier | Créer 2 pneus (`/inventory/tires`) — 1 par `admin`, 1 par `fatou` | Référentiel pneus prêt (2 références, 2 profils) |
| 3 | Admin ou Logisticien | Créer 2 fournisseurs | Référentiel achats prêt |
| 4 | Admin ou Secrétaire | Créer 2 clients | Référentiel commercial prêt |
| 5 | Admin | Vérifier `Vue d'ensemble` | Les KPI initiaux remontent sans erreur API |

### Jeu de données P1 — prêt à saisir

Préfixe **`P1-`** sur immatriculations, références et noms pour éviter les doublons avec des données déjà présentes en base.

> **Note création véhicule :** après validation du formulaire, l'app redirige vers le workflow d'acquisition (`/workflows/vehicle-acquisition`). Le véhicule est déjà enregistré — revenir sur `/vehicles` pour enchaîner, ou compléter le workflow plus tard (P5).
>
> **Format VIN (obligatoire) :** exactement **17 caractères**, lettres/chiffres uniquement, **sans I, O ni Q** (norme ISO). Les VIN du tableau ci-dessous passent l'étape **Validation VIN** du workflow. Le VIN est **modifiable directement à l'étape 2** du workflow avant de cliquer **Valider le VIN**.

#### Contrôle avant de commencer

Noter les valeurs actuelles sur `/admin/dashboard` (onglet **Vue d'ensemble**) :

| KPI | Valeur avant P1 |
|-----|----------------|
| Véhicules actifs (opérationnels / total) | |
| Pièces en stock | |
| Valeur stock total | |
| Alertes réapprovisionnement | |

Les résultats attendus ci-dessous supposent une **base vide** (0 véhicule, 0 pièce, 0 fournisseur, 0 client). Si la base Neon contient déjà des enregistrements (ex. 3 véhicules, clients BOLLORE/CNPCC), **additionner** les deltas indiqués.

---

#### Étape 1 — Véhicules (`admin` → `/vehicles/new`)

Créer **dans cet ordre**. Remplir **toutes les sections** du formulaire (identité, technique, administratif, maintenance, notes).

**Véhicule A — opérationnel**

| Section | Champ UI | Valeur |
|---------|----------|--------|
| Identité | Immatriculation | `LT-P1-001` |
| Identité | Marque | `Volvo` |
| Identité | Modèle | `FH16` |
| Identité | Type | `Tracteur` |
| Identité | Statut | `Opérationnel` |
| Identité | N° de série (VIN) | `LTP1A00000000001` |
| Technique | Année | `2022` |
| Technique | Kilométrage | `185000` |
| Technique | Tonnage | `40` |
| Technique | Nombre d'essieux | `3` |
| Technique | Spécifications moteur | `13L 500CV Euro 6` |
| Technique | Type de carburant | `Diesel` |
| Administratif | Date d'achat | `2022-03-15` |
| Administratif | Prix d'achat (F CFA) | `45000000` |
| Administratif | Expiration carte grise | `2027-06-30` |
| Administratif | Expiration assurance | `2026-12-31` |
| Administratif | Date visite technique | `2026-04-20` |
| Maintenance | Prochaine maintenance (date) | `2026-10-01` |
| Maintenance | Prochaine maintenance (km) | `200000` |
| Notes | Notes | `QA P1 — véhicule actif mission longue distance` |

**Véhicule B — opérationnel**

| Section | Champ UI | Valeur |
|---------|----------|--------|
| Identité | Immatriculation | `LT-P1-002` |
| Identité | Marque | `Mercedes` |
| Identité | Modèle | `Actros` |
| Identité | Type | `Porteur` |
| Identité | Statut | `Opérationnel` |
| Identité | N° de série (VIN) | `LTP1B00000000002` |
| Technique | Année | `2021` |
| Technique | Kilométrage | `92000` |
| Technique | Tonnage | `26` |
| Technique | Nombre d'essieux | `2` |
| Technique | Spécifications moteur | `12.8L 420CV Euro 6` |
| Technique | Type de carburant | `Diesel` |
| Administratif | Date d'achat | `2021-09-10` |
| Administratif | Prix d'achat (F CFA) | `32000000` |
| Administratif | Expiration carte grise | `2027-03-15` |
| Administratif | Expiration assurance | `2026-11-30` |
| Administratif | Date visite technique | `2026-05-10` |
| Maintenance | Prochaine maintenance (date) | `2026-09-20` |
| Maintenance | Prochaine maintenance (km) | `110000` |
| Notes | Notes | `QA P1 — véhicule actif distribution urbaine` |

**Véhicule C — en maintenance**

| Section | Champ UI | Valeur |
|---------|----------|--------|
| Identité | Immatriculation | `LT-P1-003` |
| Identité | Marque | `Scania` |
| Identité | Modèle | `R450` |
| Identité | Type | `Tracteur` |
| Identité | Statut | `En maintenance` |
| Identité | N° de série (VIN) | `LTP1C00000000003` |
| Technique | Année | `2020` |
| Technique | Kilométrage | `241000` |
| Technique | Tonnage | `38` |
| Technique | Nombre d'essieux | `3` |
| Technique | Spécifications moteur | `13L 450CV Euro 6` |
| Technique | Type de carburant | `Diesel` |
| Administratif | Date d'achat | `2020-01-20` |
| Administratif | Prix d'achat (F CFA) | `38000000` |
| Administratif | Expiration carte grise | `2026-02-28` |
| Administratif | Expiration assurance | `2026-03-31` |
| Administratif | Date visite technique | `2025-11-05` |
| Maintenance | Prochaine maintenance (date) | `2026-09-15` |
| Maintenance | Prochaine maintenance (km) | `250000` |
| Notes | Notes | `QA P1 — véhicule en atelier (freinage)` |

> **Champs optionnels :** vous pouvez laisser vides les champs non listés. Ceux ci-dessus couvrent toutes les sections visibles du formulaire (y compris **Informations administratives** et **Maintenance**).
>
> **Dates de maintenance :** doivent être **strictement postérieures à la date du jour** (le workflow d'acquisition refuse les dates passées à l'étape 4). Si vous testez après le 18/08/2026, repoussez ces dates si besoin.

**Résultat attendu étape 1 :** 3 véhicules visibles sur `/vehicles` — 2 `Opérationnel`, 1 `En maintenance`.

#### Workflow d'acquisition — compléter après création (`/workflows/vehicle-acquisition?vehicleId=…`)

| Étape workflow | Action | Valeurs P1 (véhicule A) |
|----------------|--------|-------------------------|
| 2 — Validation VIN | Corriger si besoin, puis **Valider le VIN** | VIN : `LTP1A00000000001` |
| 3 — Documents | Importer carte grise, assurance, visite technique (PDF ou image test) | Fichiers libres (ex. `test-carte-grise.pdf`) |
| 4 — Planification maintenance | **Date de première maintenance** + **Type** → **Programmer la maintenance** | Reprendre la **même date** que « Prochaine maintenance (date) » à l'étape 1 (pré-remplie si déjà saisie). Type : **Préventive Standard**. Le km reste celui de l'étape 1. |
| 5 — Activation | **Activer le véhicule dans la flotte** | Récapitulatif OK → activation |

**Étape 4 — valeurs par véhicule :**

| Véhicule | Date première maintenance | Type |
|----------|---------------------------|------|
| A (LT-P1-001) | `2026-10-01` | Préventive Standard |
| B (LT-P1-002) | `2026-09-20` | Préventive Standard |
| C (LT-P1-003) | `2026-09-15` | Préventive Standard |

> L'étape 4 **confirme** la planification déjà saisée à la création du véhicule (date + km). Seuls ajouts : validation explicite de la date et **type d'intervention** (Préventive / Révision / Inspection). Date future obligatoire.

---

#### Étape 2 — Pièces de rechange (`admin` ou `fatou` → `/inventory/new`)

> **Important :** les **pneus** ne sont pas des pièces dans FleetOS. Ils ont un module dédié (étape **2b**). Ne pas créer de pneu ici.

> **Fournisseur :** même référentiel que les pneus (`/procurement/suppliers`). Créer d'abord les fiches **étape 3**, puis choisir le fournisseur dans le combobox (pas de saisie libre).

| # | Nom | Référence | Catégorie | Qté | Seuil min | Unité | Emplacement | Prix unitaire (FCFA) | Fournisseur (combobox) |
|---|-----|-----------|-----------|-----|-----------|-------|-------------|---------------------|------------------------|
| 1 | Filtre à huile moteur | `P1-FH-001` | `FILTRES` | 50 | 10 | `pièce` | `Rayon A-12` | 15 000 | `CFAO MOBILITY` |
| 2 | Plaquettes de frein | `P1-PF-002` | `FREINAGE` | 12 | 5 | `jeu` | `Rayon B-04` | 45 000 | `CFAO MOBILITY` |
| 3 | Joint de vidange | `P1-JV-003` | `FILTRES` | 4 | 8 | `pièce` | `Rayon A-14` | 3 500 | `CFAO MOBILITY` |

> La pièce **P1-JV-003** est volontairement **sous le seuil** (4 &lt; 8) pour alimenter l'alerte réapprovisionnement pièces dès P1.

**Résultat attendu étape 2 :** 3 lignes sur `/inventory` ; alerte stock bas sur `P1-JV-003`.

---

#### Étape 2b — Pneus (`/inventory/tires` → onglet **Nouveau pneu**)

Formulaire **wizard en 5 étapes** (Produit → Technique → Traçabilité → Stock → Validation) avec **brouillon auto** dans le navigateur à chaque étape. Si l'onglet est fermé puis rouvert, un toast propose de reprendre le brouillon.

Créer **après l'étape 3** (fournisseur `TRACTAFRIC MOTOR` dans le combobox — référentiel commun avec les pièces).

**Deux fiches distinctes** — une par profil autorisé au catalogue (`admin` + `warehouse` / `fatou`), pour valider le RBAC création et la traçabilité `created_by` :

| Étape | Champs à renseigner |
|-------|---------------------|
| 1 Produit | Marque, modèle, dimension |
| 2 Technique | Essieu, compound, indices, renfort |
| 3 Traçabilité | DOT, semaine/année fabrication |
| 4 Stock | Quantités, prix, fournisseur, emplacement |
| 5 Validation | Notes (optionnel) + récap + **Ajouter le pneu** |

##### Pneu A — `admin`

| Champ UI | Valeur |
|----------|--------|
| Marque (liste ou « Autre ») | `Michelin` |
| Modèle | `X Multi Energy` |
| Dimension | preset `295/80R22.5` ou saisie `295` / `80` / `22.5` |
| Essieu / usage | `Moteur (traction)` |
| Saison / compound | `Toutes saisons` |
| Indice vitesse (liste) | `K — 110 km/h` |
| Indice charge (liste searchable) | `152 — 3 550 kg` |
| Code DOT (optionnel) | `DOT ABCD 1234 1224` → surligne **1224**, remplit sem. **12** / **2024**, badge âge |
| Semaine fabrication (liste) | `Semaine 12` |
| Année fabrication (liste) | `2024` |
| N° de série | *(optionnel)* |
| Renfort | `Renforcé` |
| Grade qualité | `Standard` |
| Quantité stock | `4` |
| Seuil minimal | `8` |
| Prix d'achat (FCFA) | `120 000` |
| Fournisseur (combobox searchable) | `TRACTAFRIC MOTOR` |
| Emplacement | `Zone pneus A` |
| Date réception | date du jour |
| Garantie (mois) | `24` |
| Notes | `QA P1 — créé par admin` |

> Stock volontairement **sous le seuil** (4 &lt; 8) pour l'alerte stock bas **pneus** (`GET /api/tires/low-stock`). Cela n'impacte **pas** les KPI « Pièces en stock » du dashboard admin.

##### Pneu B — `fatou` (magasinier)

> **Test temps réel (P5b étape 2) :** pendant que `fatou` remplit ce wizard, `terry` garde `/inventory/tires` ouvert dans un **autre navigateur** → la ligne doit apparaître **sans rafraîchir** (`tire_created`).

| Champ UI | Valeur |
|----------|--------|
| Marque | `Continental` |
| Modèle | `Hybrid HD3` |
| Dimension | preset `315/80R22.5` ou saisie `315` / `80` / `22.5` |
| Essieu / usage | `Remorque` |
| Saison / compound | `Toutes saisons` |
| Indice vitesse (liste) | `K — 110 km/h` |
| Indice charge (liste searchable) | `154 — 3 750 kg` |
| Code DOT (optionnel) | `DOT EFGH 5678 3824` → sem. **38** / **2024** |
| Semaine fabrication (liste) | `Semaine 38` |
| Année fabrication (liste) | `2024` |
| Renfort | `Standard` |
| Grade qualité | `Premium` |
| Quantité stock | `6` |
| Seuil minimal | `4` |
| Prix d'achat (FCFA) | `135 000` |
| Fournisseur (combobox searchable) | `TRACTAFRIC MOTOR` |
| Emplacement | `Zone pneus B` |
| Date réception | date du jour |
| Garantie (mois) | `24` |
| Notes | `QA P1 — créé par fatou` |

**Résultat attendu étape 2b :** **2 lignes** sur `/inventory/tires` (Michelin + Continental) ; alerte stock bas sur le pneu A uniquement ; fiche détail : `created_by` = admin pour A, fatou pour B.

---

#### Étape 3 — Fournisseurs (`admin` ou `issouf` → `/procurement/suppliers/new`)

Noms alignés sur le référentiel Excel importé (`CFAO MOBILITY`, `TRACTAFRIC MOTOR`, etc.). Ces fiches alimentent **à la fois** le combobox pièces et le combobox pneus.

**Fournisseur 1 — pièces détachées**

| Champ | Valeur |
|-------|--------|
| Nom | `CFAO MOBILITY` |
| Contact | `Service Achats Pièces` |
| Email | `achats.pièces@cfaomobility-cm.test` |
| Téléphone | `+237 233 42 50 00` |
| Adresse | `Bonanjo, Douala` |
| Catégorie | `Pièces détachées` |
| Délai paiement (jours) | `30` |
| Actif | Oui |

**Fournisseur 2 — pneumatiques poids lourds**

| Champ | Valeur |
|-------|--------|
| Nom | `TRACTAFRIC MOTOR` |
| Contact | `Service Pneumatiques PL` |
| Email | `pneus.pl@tractafric-motor.test` |
| Téléphone | `+237 222 50 60 70` |
| Adresse | `Zone industrielle, Yaoundé` |
| Catégorie | `Pneumatiques` |
| Délai paiement (jours) | `45` |
| Actif | Oui |

**Résultat attendu étape 3 :** 2 fournisseurs listés sur `/procurement/suppliers`.

---

#### Étape 4 — Clients (`admin` ou `dana` → `/operations` → onglet **Clients**)

**Option A — base déjà peuplée (Neon courant)**

Si **BOLLORE LOGISTICS CAMEROUN** et **CNPCC** existent déjà : ne pas recréer. Vérifier qu'ils apparaissent actifs dans l'onglet Clients → étape 4 validée.

**Option B — base vide : créer 2 clients**

**Client 1**

| Champ | Valeur |
|-------|--------|
| Nom | `BOLLORE LOGISTICS CAMEROUN` |
| Contact | `Service Exploitation` |
| Email | `exploitation@bollore-qa.test` |
| Téléphone | `+237 233 40 50 60` |
| Adresse | `Port Autonome de Douala` |
| Adresse facturation | `BP 4021 Douala` |
| N° contribuable | `M1234567890123` |
| Délai paiement (jours) | `30` |

**Client 2**

| Champ | Valeur |
|-------|--------|
| Nom | `CNPCC` |
| Contact | `Direction Logistique` |
| Email | `logistique@cnpcc-qa.test` |
| Téléphone | `+237 222 21 30 40` |
| Adresse | `Yaoundé, Centre administratif` |
| Adresse facturation | `Yaoundé, Centre administratif` |
| N° contribuable | `M9876543210987` |
| Délai paiement (jours) | `45` |

**Résultat attendu étape 4 :** 2 clients actifs minimum (existants ou créés).

---

#### Étape 5 — Contrôle dashboard admin (`admin` → `/admin/dashboard`)

**KPI header (base vide + données P1 uniquement)**

| KPI (`data-testid`) | Valeur attendue |
|---------------------|-------------------|
| `admin-kpi-fleet` | `2 / 3` (2 opérationnels sur 3 total) |
| `admin-kpi-users` | `7` (comptes environnement) |
| `admin-kpi-workorders` | `0` (aucun WO créé en P1) |
| `admin-kpi-parts` | `3` pièces — sous-texte **`1` alerte stock bas** |
| `admin-kpi-stock-value` | **1 304 000 FCFA** (50×15 000 + 12×45 000 + 4×3 500) |
| `admin-kpi-alerts` | **`1`** (P1-JV-003 sous seuil — pièces uniquement) |

**Graphiques / widgets (sans erreur réseau)**

| Zone | Attendu |
|------|---------|
| Camembert statuts véhicules | 2 opérationnels, 1 maintenance, 0 hors service |
| Top pièces | Les 3 références P1 visibles |
| Alertes & urgences | Pas d'erreur API ; pas encore de docs expirants / CPC (P5) |

**Si base déjà peuplée :** remplacer les valeurs ci-dessus par `valeur_avant_P1 + delta_P1` :

| Delta P1 | |
|----------|--|
| Véhicules | +3 total (+2 opérationnels, +1 maintenance) |
| Pièces | +3 (+1 alerte stock bas si P1-JV-003 créée) |
| Pneus | +2 (étape 2b — 1 admin + 1 fatou — hors KPI dashboard admin) |
| Valeur stock pièces | +1 304 000 FCFA |
| Fournisseurs | +2 |
| Clients | +0 si BOLLORE/CNPCC existent, sinon +2 |

**API rapide (optionnel)**

```http
GET /api/statistics/fleet        → operational: 2, maintenance: 1 (+ existant)
GET /api/parts/statistics        → totalParts: 3 (+ existant), lowStockCount: ≥ 1
GET /api/suppliers               → ≥ 2 entrées P1
GET /api/clients                 → ≥ 2 clients actifs
```

---

## P2 — Maintenance inter-profils (WO + pièces)

**État : En cours**

**But :** valider la chaîne Atelier: création WO par encadrement, exécution par technicien, impact stock.

| Étape | Profil connecté | Action | Résultat attendu |
|------|------------------|--------|------------------|
| 1 | Admin/chef d'atelier | Créer un Work Order lié à un véhicule | WO visible en statut initial (`pending` ou équivalent) |
| 2 | Admin/chef d'atelier | Assigner le WO à un technicien existant | Technicien voit le WO dans son dashboard |
| 3 | Technicien | Passer le WO en `in_progress` puis saisir les infos d'intervention | Historique du WO mis à jour |
| 4 | Technicien | Demander ou consommer une pièce liée au WO | Mouvement stock tracé |
| 5 | Magasinier | Valider la sortie pièce | Quantité stock décrémentée |
| 6 | Technicien | Clôturer le WO (`completed`) | Feed admin "Work Orders" mis à jour |
| 7 | Admin | Vérifier dashboard admin | Widgets WO + activité récente cohérents |

---

## P3 — Réapprovisionnement inter-profils

**État : À faire**

**But :** valider les 2 parcours possibles :
- **Flux magasin direct** (demande de pièce jusqu'à la réception/sortie stock)
- **Flux achats formel** (demande convertie en commande fournisseur puis facture)

| Étape | Profil connecté | Action | Résultat attendu |
|------|------------------|--------|------------------|
| 1 | Magasinier / Technicien / Chef d'atelier | Créer une demande de pièce | Demande créée (`pending`) |
| 2 | Chef d'atelier / Admin | Valider la demande | Demande `approved` |
| 3A | Magasinier | **Flux direct:** cliquer `Commander` dans `Demandes de pièces` | Demande `ordered` |
| 4A | Magasinier | **Flux direct:** confirmer réception puis sortie stock | Demande `received` puis `issued` |
| 3B | Logisticien / Secrétaire / Magasinier / Admin | **Flux achats:** convertir les demandes `approved` en commande fournisseur (`/procurement/orders`) | Commande achat créée (`draft` puis `sent`/`confirmed`) |
| 4B | Logisticien / Magasinier | Suivre réception dans la commande fournisseur + pièces livrées | Commande mise à jour, alertes envoyées |
| 5B | Logisticien/Compta | Enregistrer facture fournisseur liée à la commande | Facture fournisseur créée |
| 6 | Admin | Vérifier onglet Financier | KPI fournisseurs, retards et matching 3-way mis à jour |

### Suite du parcours : règlement et rapprochement

P3 s'arrête à la création de la facture fournisseur. La suite — validation,
approbation, saisie du règlement avec **justificatif obligatoire**, puis
rapprochement jusqu'au statut `Payée` — est décrite pas à pas dans
`docs/qa/E2E PANNE-OT-REAPPRO-FACTURE`, étapes 13 à 15.

Ne pas dupliquer ces étapes ici : les deux documents se recouvraient déjà
partiellement sans se référencer. Exécuter P3 puis enchaîner sur ce document
avec les mêmes données.

---

## P4 — Opérations inter-profils (mission à paiement)

**État : À faire**

**But :** valider la chaîne client complète: mission, facturation, encaissement.

Parfait. Voici un **jeu de données P4** prêt à tester de bout en bout.

État actuel détecté dans ta base:
- `clients`: 2 (id `1` BOLLORE, id `2` CNPCC)
- `vehicles`: 3 (id `1`, `2`, `3`)
- `missions`: 0
- `client_invoices`: 0
- `drivers`: 0 (important pour l’étape “assigner chauffeur”)

### 1) Donnée chauffeur — par l'interface, pas en SQL

> Corrigé : ce document faisait auparavant créer le chauffeur par un `INSERT`
> SQL direct. L'API (`POST /api/drivers`) et l'écran existent désormais
> (phases A et B de `docs/analysis/AUDIT_CREATION_CHAUFFEURS_ADMIN_USERS.md`).
> Passer par l'UI teste la fonctionnalité au lieu de la contourner.

| Étape | Profil connecté | Action | Résultat attendu |
|------|------------------|--------|------------------|
| 1 | `admin` | `/admin/users` → onglet **Chauffeurs** → **Ajouter un chauffeur** | Modal de création ouverte |
| 2 | `admin` | Prénom `Jean`, Nom `Mballa`, Matricule `DRV-P4-001`, N° permis `PERMIS-P4-001`, date CPC `2025-12-01`, statut actif | Chauffeur enregistré |
| 3 | `admin` | Vérifier la liste chauffeurs | Le chauffeur apparaît **sans rafraîchir** (événement `driver_created`) |
| 4 | `issouf` (logisticien) | Ouvrir `/missions/new` | `Jean Mballa` est proposé dans le sélecteur chauffeur |
| 5 | `admin` | Désactiver le chauffeur puis rouvrir `/missions/new` | Il n'est plus assignable |

Réactiver le chauffeur avant de poursuivre P4. Noter l'`id` obtenu pour les
missions ci-dessous.

---

### 2) Mission test A (paiement partiel)
- `orderNumber`: `P4-20260309-001`
- `clientId`: `1`
- `missionType`: `delivery` (UI: `Livraison`)
- `vehicleId`: `1`
- `driverId`: `1` (si créé)
- `pickupAddress`: `Port Autonome de Douala`
- `deliveryAddress`: `Zone Logistique Bonabéri`
- `pickupDate`: `2026-03-09 08:00`
- `deliveryDate`: `2026-03-09 14:00`
- `cargo`: `Conteneurs pièces industrielles`
- `weight`: `18.5`
- `volume`: `38`
- `estimatedDistance`: `32`
- `status flow`: `planned -> in_progress -> completed`

Facture client à générer:
- `amount HT`: `1 250 000`
- `TVA`: `19.25%`
- `TTC attendu`: `1 490 625`
- `dueDate`: `2026-04-08`

Paiement à enregistrer:
- `amount`: `600 000`
- `paymentMethod`: `bank_transfer`
- `paymentDate`: `2026-03-10`
- `reference`: `P4-PAI-001`

Résultat attendu:
- statut facture: `partial`
- solde: `890 625`

---

### 3) Mission test B (paiement total)
- `orderNumber`: `P4-20260309-002`
- `clientId`: `2`
- `missionType`: `delivery` (UI: `Livraison`)
- `vehicleId`: `2`
- `driverId`: `1` (si créé)
- `pickupAddress`: `Bassa Industriel`
- `deliveryAddress`: `Port Kribi`
- `pickupDate`: `2026-03-10 07:30`
- `deliveryDate`: `2026-03-10 16:30`
- `cargo`: `Ciment en palettes`
- `weight`: `22`
- `volume`: `45`
- `estimatedDistance`: `210`
- `status flow`: `planned -> in_progress -> completed`

Facture client à générer:
- `amount HT`: `840 000`
- `TVA`: `19.25%`
- `TTC attendu`: `1 001 700`
- `dueDate`: `2026-04-09`

Paiement à enregistrer:
- `amount`: `1 001 700`
- `paymentMethod`: `mobile_money`
- `paymentDate`: `2026-03-11`
- `reference`: `P4-PAI-002`

Résultat attendu:
- statut facture: `paid`
- solde: `0`

---

### 4) Mission test C (temps réel — multi-profils)
Objectif: valider les mises à jour **instantanées** (sans F5) sur les pages missions, factures et dashboards.

Préparation:
- Ouvrir 3 sessions en parallèle:
  - `issouf` (Issouf Coulibaly, logisticien) sur `/missions`
  - `dana` (Dana Del Rey, secrétaire) sur `/operations?tab=factures`
  - `admin` (Administrateur Système) sur dashboard admin (vue globale + financier)

Données mission C:
- `orderNumber`: `P4-20260330-RT01`
- `clientId`: `1` (BOLLORE LOGISTICS CAMEROUN)
- `missionType`: `delivery`
- `vehicleId`: `3`
- `driverId`: `1` (si créé)
- `pickupAddress`: `Zone Portuaire Bonabéri`
- `deliveryAddress`: `Zone Industrielle Bassa`
- `pickupDate`: `2026-03-30 09:00`
- `deliveryDate`: `2026-03-30 17:30`
- `cargo`: `Pièces maintenance urgentes`
- `weight`: `9.5`
- `volume`: `16`
- `estimatedDistance`: `48`

Parcours temps réel à exécuter:
1. `issouf` (logisticien) crée la mission (statut `planned`).
   - Attendu: la mission apparaît sans refresh dans les autres vues (compteurs/listes).
2. `issouf` assigne véhicule + chauffeur et enregistre les budgets mission.
   - Attendu: détails mission et KPI/counters reflètent immédiatement l’affectation.
3. `issouf` lance la mission (`in_progress`).
   - Attendu: statut visible en temps réel partout (liste missions + dashboards).
4. `issouf` passe la mission en `completed`/`livrée` avec date réelle.
   - Attendu: date réelle visible immédiatement; mission sort des “en cours”.
5. `dana` (secrétaire) génère la facture client.
   - `amount HT`: `300 000`
   - `TVA`: `19.25%`
   - `TTC attendu`: `357 750`
   - Attendu: facture visible sans refresh dans la vue factures + KPI financiers.
6. `dana` enregistre un paiement partiel.
   - `amount`: `100 000`
   - Attendu: statut `partial`, solde restant mis à jour en temps réel.
7. `dana` enregistre le paiement du solde.
   - `amount`: `257 750`
   - Attendu: statut `paid`, reste à encaisser = `0`, KPI synchronisés sans F5.

---

### 5) Contrôle final attendu (P4)
Après les missions A + B (+ C si exécutée):
- Factures créées: `2`
- Total HT: `2 090 000`
- Total TVA: `402 325`
- Total TTC: `2 492 325`
- Total encaissé: `1 601 700`
- Solde total restant: `890 625`
- Répartition statuts facture: `1 partial`, `1 paid`

Si mission C exécutée en plus:
- Factures créées: `3`
- Total HT: `2 390 000`
- Total TVA: `460 075`
- Total TTC: `2 850 075`
- Total encaissé: `1 959 450`
- Solde total restant: `890 625`
- Répartition statuts facture: `1 partial`, `2 paid`



| Étape | Profil connecté | Action | Résultat attendu |
|------|------------------|--------|------------------|
| 1 | Secrétaire/Logisticien | Créer une mission pour un client existant | Mission créée (`draft`/`planned`) |
| 2 | Logisticien | Assigner véhicule + chauffeur puis passer en `assigned`/`in_progress` | Mission avance correctement |
| 3 | Logisticien | Passer mission en `completed` | Mission clôturée |
| 4 | Secrétaire/Compta | Générer facture client | Facture client créée |
| 5 | Compta/Admin | Enregistrer un paiement (partiel ou total) | Solde facture ajusté |
| 6 | Admin | Vérifier dashboard admin financier | CA client, encaissements et feed missions cohérents |

---

## P5 — Conformité documentaire

**État : À faire**

**But :** valider les alertes de conformité qui alimentent la zone "Alertes & urgences".

| Étape | Profil connecté | Action | Résultat attendu |
|------|------------------|--------|------------------|
| 1 | Admin/gestion flotte | Ajouter un document véhicule expirant à J+10 | Alerte "documents expirants" visible |
| 2 | Admin/gestion RH | Mettre un CPC chauffeur proche expiration | Alerte CPC visible |
| 3 | Admin | Vérifier priorisation des alertes | Ordre par urgence cohérent |
| 4 | Admin | Corriger les dates (renouvellement) | Alertes disparaissent après refresh |

---

## P5b — Cycle de vie des pneus (magasin ↔ atelier)

**État : À faire**

**But :** valider le module pneus en exploitation. P1 étape 2b crée **2 fiches**
(admin + fatou) ; ce parcours teste ce qu'on en fait ensuite.

C'est le seul parcours qui traverse **deux métiers sur le même écran** : le
magasin tient le catalogue, l'atelier gère le montage. Le partage des rôles suit
la feuille Excel PNEUMATIQUE (voir `AGENTS.md` §5, « RBAC pneus »).

| Étape | Profil connecté | Action | Résultat attendu |
|------|------------------|--------|------------------|
| 1 | `fatou` (magasinier) | Vérifier les 2 fiches P1 sur `/inventory/tires` | Michelin (stock 4, alerte) + Continental (stock 6) visibles |
| 2 | `terry` (chef d'atelier) | *(déjà testé en P1)* ou reproduire : ouvrir `/inventory/tires` **pendant** que fatou crée le pneu B | La ligne apparaît **sans rafraîchir** (`tire_created`) |
| 3 | `terry` | Monter le pneu A (Michelin) sur un véhicule (position `front_left`, date + km obligatoires) | Montage enregistré, pneu visible sur la fiche véhicule |
| 4 | `terry` | Tenter un montage **sans date d'installation** | Erreur **400** avec le champ manquant nommé — pas un 500 |
| 5 | `fatou` | Tenter de monter un pneu | **403** : le montage est un acte d'atelier |
| 6 | `terry` | Tenter de créer une fiche pneu | **403** : le catalogue est au magasin |
| 7 | `ali` (technicien) | Saisir une inspection (profondeur, pression, usure, action recommandée) | Inspection enregistrée, état du pneu mis à jour |
| 8 | `terry` | Planifier une rotation (type, date, km) | Rotation créée, positions mises à jour |
| 9 | `terry` | Démonter un pneu (km au démontage) | Pneu `removed`, sort de la fiche véhicule |
| 10 | `fatou` | Vérifier le stock et les alertes seuil | Quantités cohérentes, alerte si sous le seuil |
| 11 | `admin` | Vérifier le dashboard | Statistiques pneus alignées avec les mouvements |

**Contrôles obligatoires :**

1. Les étapes 5 et 6 doivent renvoyer **403**, pas un écran qui semble marcher.
   Un bouton visible mais interdit est un défaut à signaler.
2. L'étape 2 valide le temps réel inter-profils : vérifier **sans** rafraîchir.
3. L'étape 4 valide que les erreurs de saisie remontent en 400 avec le détail du
   champ, et non en 500 générique.

---

## P5c — Carburant et carte rechargeable

**État : À faire**

**But :** valider le module carburant, absent des parcours jusqu'ici alors qu'il
porte son propre service et une carte à solde.

| Étape | Profil connecté | Action | Résultat attendu |
|------|------------------|--------|------------------|
| 1 | `admin` ou `terry` | Recharger la carte carburant (montant, référence) | Solde augmenté, opération dans l'historique |
| 2 | `issouf` (logisticien) | Enregistrer un plein pour un véhicule (litres, prix unitaire, km) | Consommation enregistrée, solde débité |
| 3 | `issouf` | Vérifier le kilométrage du véhicule | Km mis à jour depuis le plein |
| 4 | `issouf` | Enregistrer un plein avec une consommation anormalement élevée | **Anomalie détectée** et remontée |
| 5 | `issouf` | Lier un plein à une mission existante (P4) | Coût carburant rattaché à la mission |
| 6 | `admin` | Consulter les statistiques par véhicule et par client | Totaux cohérents avec les étapes 1 à 5 |
| 7 | `terry` | Tenter d'enregistrer une **consommation** | Refusé : le chef d'atelier recharge, il ne consomme pas |
| 8 | `admin` | Vérifier le solde après toutes les opérations | `solde = recharges - consommations` |

**Contrôle obligatoire :** l'étape 8 est le contrôle d'intégrité du module. Un
écart signale une opération non décomptée.

---

## P5d — Renouvellement de documents véhicules

**État : À faire**

**But :** valider le workflow qui prend le relais de P5. P5 s'arrête à l'alerte
d'expiration ; ici on traite la demande jusqu'au document renouvelé.

Rôles (contrôlés en ligne dans `server/api/document-renewals.routes.ts`, pas par
middleware) : consultation pour `admin`, `secretary`, `logistics`,
`workshop_manager`, `technician` ; **création** réservée aux quatre premiers.
Types demandables : `carte_grise`, `assurance`, `visite_technique`, `taxe`,
`autre`. Statuts : `pending` → `in_progress` → `completed` (ou `rejected`).

| Étape | Profil connecté | Action | Résultat attendu |
|------|------------------|--------|------------------|
| 1 | `admin` | Vérifier la liste des centres agréés (`/api/document-renewals/centers`) | Centres listés, filtrables par type de document |
| 2 | `dana` (secrétaire) | `/vehicles/documents/renew` → créer une demande `visite_technique` sur un véhicule de P1 | Demande créée en `pending`, centre et rôle assigné renseignés |
| 3 | `ali` (technicien) | Ouvrir la liste des demandes | Il **voit** la demande (rôle en consultation) |
| 4 | `ali` | Tenter de créer une demande | **Refusé** : le technicien consulte, il ne crée pas |
| 5 | `dana` | Passer la demande en `in_progress` | Statut mis à jour, visible sans rafraîchir chez `admin` |
| 6 | `dana` | Clôturer en `completed` avec la nouvelle date d'expiration | Demande `completed`, **date du document véhicule mise à jour** |
| 7 | `admin` | Revenir sur la zone « Alertes & urgences » | L'alerte d'expiration de P5 a **disparu** |
| 8 | `dana` | Créer puis rejeter une seconde demande avec motif | Statut `rejected`, motif conservé |

**Contrôle obligatoire :** l'étape 7 est le bouclage avec P5. Si l'alerte
subsiste après un renouvellement `completed`, la date n'a pas été propagée au
document véhicule.

---

## P5e — Catalogue des pannes

**État : À faire**

**But :** valider le référentiel de pannes utilisé à la création d'un ordre de
travail.

Rôles : lecture pour tout profil authentifié, création et modification pour
`admin` + `workshop_manager`, **suppression réservée à `admin`**.
Statuts : `draft` → `validated` → `archived`.

| Étape | Profil connecté | Action | Résultat attendu |
|------|------------------|--------|------------------|
| 1 | `terry` (chef d'atelier) | `/maintenance/fault-catalog` → créer une panne : nom, description, catégorie `Moteur` | Panne créée en `draft` |
| 2 | `terry` | Passer la panne en `validated` | Statut mis à jour |
| 3 | `terry` | Associer des pièces types à la panne | Pièces liées visibles sur la fiche |
| 4 | `ali` (technicien) | Ouvrir le catalogue | Consultation possible |
| 5 | `ali` | Tenter de créer une panne | **Refusé** : lecture seule pour le technicien |
| 6 | `terry` | Créer un OT en s'appuyant sur cette panne (P2) | Panne et pièces types reprises dans l'OT |
| 7 | `terry` | Tenter de supprimer la panne | **403** : suppression réservée à l'admin |
| 8 | `admin` | Archiver la panne (`archived`) | Elle ne remonte plus dans la sélection à la création d'OT |

**Contrôle obligatoire :** l'étape 8 vérifie qu'une panne archivée disparaît des
sélecteurs sans casser les OT qui la référencent déjà.

---

## Hors périmètre : le pointage

Les tables `time_tracking` et `monthly_time_stats` existent dans le schéma, mais
**aucune route ni service ne les expose** (vérifié : zéro référence hors
`shared/schema.ts`). Il n'y a donc rien à tester.

Ne pas écrire de parcours QA pour ce module tant qu'une API n'existe pas : ce
document doit décrire ce que l'application fait, pas ce qu'elle pourrait faire.
Écart déjà relevé dans `docs/reports/ETAT_AVANCEMENT_ACTUEL_2026-02-20.md`
(« QHSE/permis/congés/time-tracking peu exposés en APIs/UI métier »).

---

## P6 — Connexions utilisateurs et activité récente

**État : À faire**

**But :** valider la cohérence des données temporelles de connexion et du feed multi-modules.

| Étape | Profil connecté | Action | Résultat attendu |
|------|------------------|--------|------------------|
| 1 | Technicien | Se connecter puis se déconnecter | Dernière connexion technicien mise à jour |
| 2 | Magasinier | Se connecter puis faire une action stock | Événement visible dans activité récente |
| 3 | Logisticien | Se connecter puis action mission/achat | Événement visible dans activité récente |
| 4 | Admin | Ouvrir `Gestion des utilisateurs` | Dernière connexion + compteur connexions cohérents |
| 5 | Admin | Ouvrir dashboard admin | Feed agrège WO, missions, mouvements stock par ordre chrono |

---

## P7 — Consolidation dashboard admin + export mensuel

**État : À faire**

**But :** vérifier la cohérence globale après enchaînement des parcours.

| Étape | Profil connecté | Action | Résultat attendu |
|------|------------------|--------|------------------|
| 1 | Admin | Ouvrir `Vue d'ensemble` | Graphiques et KPI cohérents avec données P2 à P6 |
| 2 | Admin | Ouvrir onglet `Financier` | CA client, fournisseurs, retards, matching alignés |
| 3 | Admin | Ouvrir onglet `Utilisateurs` | Répartition rôles + connexions cohérentes |
| 4 | Admin | Exporter rapport mensuel (`.xlsx`) | Fichier valide, onglets remplis avec données du mois |
| 5 | Admin | Tester un mois sans données | Export valide sans erreur 500 |

---

## Vérifications API recommandées (parcours dépendants)

| Domaine | Endpoint exemple | Attendu |
|---------|------------------|---------|
| Flotte | `GET /api/statistics/fleet` | 200 + compteurs cohérents |
| Work Orders | `GET /api/work-orders?limit=5` | 200 + derniers WO |
| Stock | `GET /api/parts/stock-movements` | 200 + mouvements récents |
| Achats | `GET /api/supplier-invoices/statistics` | 200 + métriques matching |
| Missions | `GET /api/operations/missions` | 200 + statuts cohérents |
| Utilisateurs | `GET /api/users` | 200 + lastLogin/counts cohérents |
| Export | `GET /api/exports/monthly-report?year=YYYY&month=M` | 200 + fichier xlsx |

---

## Critères de réussite globaux

1. Les parcours P0 → P7 passent sans reset de base.
2. Les données créées par un profil sont bien consommées par les autres profils en aval.
3. Le dashboard admin reflète l'état réel des processus, pas seulement des données isolées.
4. Les contrôles d'accès restent stricts à chaque étape.
5. Aucun crash front, aucune erreur bloquante API (4xx/5xx inattendue).

---

## Hors périmètre de ce plan

- Création d'utilisateurs (déjà réalisée).
- Tests unitaires backend/frontend.
- Tests de charge/performance massive.

---

*Document mis à jour le 20 février 2026 — approche orientée dépendances métier inter-profils.*
