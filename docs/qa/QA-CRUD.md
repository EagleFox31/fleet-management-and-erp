# Plan de tests QA — CRUD entités métier
> FleetMaster 2.0 — Tests fonctionnels de bout en bout
> Chaque scénario est indépendant sauf mention de prérequis inter-entités

---

## Conventions

| Symbole | Signification |
|---------|--------------|
| ✅ Attendu | Le comportement doit se produire |
| ❌ Refus attendu | L'application doit rejeter la saisie |
| 🔗 Dépendance | Nécessite qu'une autre entité existe |

**Navigation :** tous les formulaires sont testés via l'interface graphique de l'app. Les vérifications réseau se font via F12 → Onglet Network.

---

## Prérequis

| # | Condition |
|---|-----------|
| P1 | Application démarrée, base de données connectée |
| P2 | Connecté en tant qu'**admin** (`admin` / `admin123`) — voir `docs/qa/COMPTES_ENVIRONNEMENT.md` pour les autres profils |
| P3 | Au moins un enregistrement pré-existant dans chaque table principale (pour les tests de lecture) |

---

## 1 — Véhicules

### TC-V01 — Création d'un véhicule (cas nominal)

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Menu « Ressources Véhicules » > « Véhicules » | Liste des véhicules affichée |
| 2 | Cliquer sur "Ajouter un véhicule" | Formulaire de création ouvert |
| 3 | Renseigner : Immatriculation `AB-123-CD`, Marque `Renault`, Modèle `T480`, Année `2021`, Type `porteur`, Carburant `diesel` | Champs remplis |
| 4 | Valider le formulaire | ✅ Véhicule créé, apparaît dans la liste |
| 5 | Vérifier Network | `POST /api/vehicles` → HTTP 201, objet véhicule retourné |
| 6 | Vérifier que le KPI "Véhicules actifs" sur le dashboard admin est incrémenté | Compteur +1 |

### TC-V02 — Validation des champs obligatoires

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Ouvrir le formulaire d'ajout | — |
| 2 | Soumettre le formulaire **vide** | ❌ Erreurs de validation sur : immatriculation, marque, modèle, année, type |
| 3 | Saisir uniquement l'immatriculation, soumettre | ❌ Erreurs restantes sur les autres champs obligatoires |
| 4 | Saisir une immatriculation déjà existante | ❌ Message "Immatriculation déjà utilisée" ou HTTP 409 |

### TC-V03 — Lecture et détail

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Ouvrir la liste des véhicules | Liste paginée visible, statuts colorés |
| 2 | Cliquer sur un véhicule | Page de détail avec tous les champs (immatriculation, marque, modèle, statut, kilométrage, documents) |
| 3 | Vérifier Network | `GET /api/vehicles/:id` → HTTP 200 |
| 4 | Tester le filtre par statut "maintenance" | Seuls les véhicules en maintenance sont affichés |

### TC-V04 — Modification

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Ouvrir le détail d'un véhicule → cliquer "Modifier" | Formulaire pré-rempli avec les valeurs actuelles |
| 2 | Changer le kilométrage (ex. +5000 km) | Champ modifiable |
| 3 | Valider | ✅ Modification enregistrée, nouvelle valeur visible |
| 4 | Vérifier Network | `PUT /api/vehicles/:id` ou `PATCH /api/vehicles/:id` → HTTP 200 |
| 5 | Changer le statut vers "maintenance" | ✅ Statut mis à jour, couleur de badge changée, KPI dashboard reflété |

### TC-V05 — Suppression (soft delete)

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Sur un véhicule sans work order actif, cliquer "Supprimer" | Dialogue de confirmation affiché |
| 2 | Confirmer la suppression | ✅ Véhicule retiré de la liste |
| 3 | Vérifier Network | `DELETE /api/vehicles/:id` → HTTP 200 ou 204 |
| 4 | Vérifier que le véhicule n'apparaît plus dans les sélecteurs (formulaire WO, missions) | ✅ Absent des dropdowns |

### TC-V06 — Documents du véhicule

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Ouvrir un véhicule → section Documents | Onglet ou section Documents visible |
| 2 | Ajouter un document "assurance" avec date d'expiration dans 15 jours | ✅ Document enregistré |
| 3 | Vérifier que le widget `ExpiringDocsAlert` du dashboard le remonte | Le véhicule apparaît dans les alertes |
| 4 | Modifier la date d'expiration à +60 jours | Le véhicule disparaît des alertes |

---

## 2 — Chauffeurs

### TC-D01 — Création (cas nominal)

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Menu « Ressources Véhicules » > « Chauffeurs » (visible en `logistics` uniquement) | Liste affichée |
| 2 | Cliquer "Ajouter" | Formulaire ouvert |
| 3 | Renseigner : Prénom `Jean`, Nom `Dupont`, permis, téléphone | Champs remplis |
| 4 | Valider | ✅ Chauffeur créé, présent dans la liste |
| 5 | Vérifier Network | `POST /api/drivers` → HTTP 201 |

### TC-D02 — Champs obligatoires

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Soumettre formulaire vide | ❌ Erreurs sur prénom et nom |
| 2 | Saisir prénom seul | ❌ Erreur sur nom |

### TC-D03 — CPC : mise à jour et statuts

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Ouvrir un chauffeur → section CPC | Statut CPC affiché ("FORMÉ" / "À FORMER" / "NON FORMÉ") |
| 2 | Enregistrer une formation CPC avec date aujourd'hui | Statut passe à "FORMÉ" |
| 3 | Enregistrer une formation avec date il y a 4 ans et 11 mois | Statut "À FORMER" (expire bientôt) |
| 4 | Vérifier que le widget `ExpiringCPCAlert` remonte ce chauffeur | ✅ Apparaît dans les alertes |
| 5 | Saisir aucune formation CPC | Statut "NON FORMÉ" |

### TC-D04 — Modification et suppression

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Modifier le nom d'un chauffeur | ✅ Nom mis à jour dans la liste |
| 2 | Désactiver un chauffeur (`DELETE /api/drivers/:id`) | Chauffeur retiré de la liste active, non assignable à une mission |
| 3 | Vérifier Network | HTTP 200 ou 204 |

---

## 3 — Pièces de rechange (Warehouse)

### TC-P01 — Création d'une pièce

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Menu « Gestion de stock » > « Inventaire des pièces » | Liste des pièces affichée |
| 2 | Cliquer "Ajouter une pièce" | Formulaire ouvert |
| 3 | Renseigner : Nom `Filtre à huile`, Référence `FH-001`, Qté `10`, Qté min `3`, Prix unitaire `2500`, Unité `pièce` | Champs remplis |
| 4 | Valider | ✅ Pièce créée, visible dans l'inventaire |
| 5 | Vérifier Network | `POST /api/parts` → HTTP 201 |
| 6 | Vérifier que le KPI "Pièces en stock" du dashboard augmente | ✅ Compteur mis à jour |

### TC-P02 — Référence unique

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Créer une pièce avec une référence déjà existante | ❌ HTTP 409 ou message "Référence déjà utilisée" |

### TC-P03 — Mouvement de stock — Entrée

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Sur une pièce existante, enregistrer une **entrée** de 20 unités | Formulaire : type `in`, quantité `20`, raison `Réception commande` |
| 2 | Valider | ✅ Stock de la pièce incrémenté de 20 |
| 3 | Vérifier Network | `POST /api/warehouse/stock-movement` → HTTP 201 |
| 4 | Vérifier que le mouvement apparaît dans l'onglet "Mouvements stock" du feed activité (dashboard) | ✅ Entrée verte visible en tête de liste |

### TC-P04 — Mouvement de stock — Sortie

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Enregistrer une **sortie** de 5 unités sur la même pièce | type `out`, quantité `5`, raison `Utilisation WO-045` |
| 2 | Valider | ✅ Stock décrémenté de 5 |
| 3 | Tenter une sortie supérieure au stock disponible | ❌ Erreur "Stock insuffisant" ou blocage |
| 4 | Vérifier le mouvement dans le feed dashboard | ✅ Sortie rouge visible |

### TC-P05 — Alerte stock bas

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Réduire le stock d'une pièce en dessous de `minQuantity` | Stock < seuil |
| 2 | Vérifier le KPI "Alertes Actives" sur le dashboard | Compteur incrémenté |
| 3 | Vérifier `GET /api/warehouse/reorder-alerts` | La pièce apparaît dans les alertes |

### TC-P06 — Modification et suppression d'une pièce

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Modifier le prix unitaire d'une pièce | ✅ Nouveau prix enregistré, valeur stock total recalculée |
| 2 | Supprimer une pièce sans historique de mouvement | ✅ Supprimée |
| 3 | Tenter de supprimer une pièce avec des mouvements de stock liés | ❌ Blocage ou soft delete (selon règle métier) |

---

## 4 — Fournisseurs

### TC-S01 — Création (cas nominal)

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Menu « Approvisionnement » > « Fournisseurs » | Liste affichée |
| 2 | Cliquer "Ajouter" | Formulaire ouvert |
| 3 | Renseigner : Nom `ETS Traoré & Fils`, catégorie `Pièces`, email, téléphone, délai paiement `30` | Champs remplis |
| 4 | Valider | ✅ Fournisseur créé |
| 5 | Vérifier Network | `POST /api/suppliers` → HTTP 201 |

### TC-S02 — Nom unique

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Créer un fournisseur avec un nom déjà existant | ❌ HTTP 409 ou message d'erreur |

### TC-S03 — Modification fournisseur et évaluations par rôle

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Se connecter en `secretary` ou `admin` et modifier coordonnées fournisseur | ✅ Mise à jour enregistrée (`PATCH /api/suppliers/:id`) |
| 2 | Se connecter en `workshop_manager` ou `warehouse` et modifier `qualityRating` | ✅ HTTP 200 sur `PATCH /api/suppliers/:id/rating` |
| 3 | Se connecter en `logistics` et modifier `reliabilityRating` | ✅ HTTP 200 sur `PATCH /api/suppliers/:id/rating` |
| 4 | Se connecter en `secretary` et modifier `priceCompetitiveness` | ✅ HTTP 200 sur `PATCH /api/suppliers/:id/rating` |
| 5 | Tenter de modifier un champ non autorisé (ex: `logistics` -> `qualityRating`) | ❌ HTTP 403 (droits par métrique) |
| 6 | Vérifier affichage dans `SupplierScorecard` et détail fournisseur | ✅ Notes mises à jour visibles |

### TC-S04 — Désactivation et réactivation

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Désactiver un fournisseur | ✅ Retiré de la liste active |
| 2 | Vérifier qu'il n'est plus sélectionnable dans un nouveau bon de commande | ❌ Absent du dropdown fournisseurs |
| 3 | Réactiver le fournisseur | ✅ De retour dans la liste active |
| 4 | Vérifier Network | `PATCH /api/suppliers/:id/reactivate` → HTTP 200 |

### TC-S05 — Scorecard fournisseur

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Créer plusieurs factures fournisseur pour un même fournisseur (voir TC-FI) | — |
| 2 | Vérifier `GET /api/suppliers/top?limit=5` | Le fournisseur avec le plus grand volume apparaît en #1 |
| 3 | Vérifier la carte `SupplierScorecard` sur le dashboard Financier | Classement correct, barre proportionnelle au volume |

### TC-S06 — Calcul automatique des ratings (admin)

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Se connecter en `admin` et ouvrir un fournisseur | Détail fournisseur affiché |
| 2 | Cliquer "Calcul automatique" dans l'onglet Performance | ✅ Requête `POST /api/suppliers/:id/calculate-ratings` HTTP 200 |
| 3 | Vérifier les 3 notes (qualité, fiabilité, prix) | ✅ Notes recalculées et enregistrées |
| 4 | Refaire l'action en `secretary`, `logistics`, `warehouse` ou `workshop_manager` | ❌ HTTP 403 (réservé admin) |

---

## 5 — Clients

### TC-C01 — Création (cas nominal)

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Menu « Facturation client » > onglet « Clients » | Liste affichée |
| 2 | Cliquer "Ajouter un client" | Formulaire ouvert |
| 3 | Renseigner : Nom `SOFITEX SA`, email, téléphone, adresse, délai paiement `45` | Champs remplis |
| 4 | Valider | ✅ Client créé |
| 5 | Vérifier Network | `POST /api/clients` → HTTP 201 |

### TC-C02 — Nom unique

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Créer un client avec un nom existant | ❌ Erreur d'unicité |

### TC-C03 — Modification et suppression

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Modifier le numéro de téléphone | ✅ Mis à jour |
| 2 | Désactiver un client sans facture active | ✅ Désactivé, retiré des listes |
| 3 | Désactiver un client avec des missions en cours | ❌ Blocage ou avertissement (selon règle métier) |

---

## 6 — Work Orders (Interventions)

🔗 *Prérequis : au moins un véhicule existant*

### TC-WO01 — Création (cas nominal)

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Menu « Maintenance » > « Ordres de travail » | Liste affichée |
| 2 | Cliquer "Créer un work order" | Formulaire ouvert |
| 3 | Renseigner : Véhicule (sélectionner un véhicule), Titre `Vidange + filtres`, Priorité `haute`, Statut `pending` | Champs remplis |
| 4 | Valider | ✅ WO créé avec un numéro auto-généré |
| 5 | Vérifier Network | `POST /api/work-orders` → HTTP 201 |
| 6 | Vérifier le KPI "Work Orders actifs" sur le dashboard | Compteur +1 |
| 7 | Vérifier le feed activité (onglet Work Orders) | Nouveau WO visible en tête |

### TC-WO02 — Champs obligatoires

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Soumettre sans véhicule | ❌ Erreur "Véhicule requis" |
| 2 | Soumettre sans titre | ❌ Erreur "Titre requis" |

### TC-WO03 — Cycle de vie des statuts

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Passer un WO de `pending` → `in_progress` | ✅ Statut mis à jour, badge bleu |
| 2 | Passer à `awaiting_parts` | ✅ Badge orange |
| 3 | Passer à `completed` | ✅ Badge vert, WO décompté des "actifs" sur le dashboard |
| 4 | Vérifier Network | `PATCH /api/work-orders/:id/status` → HTTP 200 |
| 5 | Tenter de repasser un WO `completed` en `pending` | Selon règle métier : ❌ bloqué ou ✅ autorisé |

### TC-WO04 — Modification et suppression

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Modifier la description d'un WO | ✅ Enregistrée |
| 2 | Assigner un technicien | ✅ Technicien visible sur la fiche |
| 3 | Supprimer un WO en statut `pending` | ✅ Supprimé |
| 4 | Tenter de supprimer un WO `in_progress` | ❌ Bloqué ou avertissement |

---

## 7 — Missions (Transport)

🔗 *Prérequis : au moins un client, un véhicule et un chauffeur existants*

### TC-M01 — Création (cas nominal)

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Menu « Facturation client » > onglet « Missions » | Liste affichée |
| 2 | Cliquer "Nouvelle mission" | Formulaire ouvert |
| 3 | Renseigner : N° ordre `MISS-2025-001`, Type `livraison`, Client (sélection), Adresse enlèvement, Adresse livraison, Date enlèvement, Date livraison prévue | Champs remplis |
| 4 | Valider | ✅ Mission créée en statut `draft` |
| 5 | Vérifier Network | `POST /api/missions` → HTTP 201 |
| 6 | Vérifier le feed activité du dashboard | Mission visible en tête |

### TC-M02 — N° de commande unique

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Créer une mission avec un `orderNumber` existant | ❌ Erreur d'unicité |

### TC-M03 — Cycle de vie des statuts

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Passer la mission de `draft` → `planned` | ✅ |
| 2 | Assigner un véhicule et un chauffeur → statut `assigned` | ✅ |
| 3 | Démarrer la mission → `in_progress` | ✅ |
| 4 | Marquer comme livrée → `delivered` | ✅ |
| 5 | Compléter → `completed` | ✅ |
| 6 | Vérifier Network à chaque transition | `PUT /api/missions/:id/status` → HTTP 200 |

### TC-M04 — Annulation

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Annuler une mission en statut `planned` | ✅ Statut `cancelled`, raison d'annulation saisie |
| 2 | Tenter d'annuler une mission `completed` | ❌ Bloqué ou avertissement |

---

## 8 — Commandes d'achat (Purchase Orders)

🔗 *Prérequis : au moins un fournisseur actif*

### TC-PO01 — Création manuelle

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Menu « Approvisionnement » > « Commandes » | Liste affichée |
| 2 | Cliquer "Nouvelle commande" | Formulaire ouvert |
| 3 | Sélectionner un fournisseur, saisir une date de commande, ajouter des lignes (pièce, quantité, prix unitaire) | Champs remplis |
| 4 | Valider | ✅ Commande créée en statut `draft` |
| 5 | Vérifier Network | `POST /api/purchase-orders` → HTTP 201 |

### TC-PO02 — Cycle de vie des statuts

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Passer de `draft` → `sent` (envoi au fournisseur) | ✅ |
| 2 | Marquer comme `confirmed` (fournisseur a confirmé) | ✅ |
| 3 | Saisir une livraison partielle → `partial` | ✅ |
| 4 | Livraison complète → `delivered` | ✅ Stock des pièces commandées mis à jour |
| 5 | Valider → `completed` | ✅ |

### TC-PO03 — Retard de livraison (widget dashboard)

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Créer une commande avec `expectedDeliveryDate` = hier, statut `sent` | — |
| 2 | Vérifier le widget `OverdueOrdersAlert` sur le dashboard | ✅ Commande visible dans les alertes |
| 3 | Vérifier que le badge d'urgence est rouge si > 30j de retard | ✅ |
| 4 | Marquer la commande `delivered` | ✅ Disparaît des alertes |

---

## 9 — Factures fournisseurs (Supplier Invoices)

🔗 *Prérequis : fournisseur existant, idéalement une commande d'achat liée*

### TC-FI01 — Création (cas nominal)

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Menu « Approvisionnement » > « Facture fournisseur » | Liste affichée |
| 2 | Cliquer "Nouvelle facture" | Formulaire ouvert |
| 3 | Renseigner : Fournisseur, N° facture `FACT-2025-001`, Date facture, Montant HT `150000`, TVA auto-calculée | Champs remplis |
| 4 | Valider | ✅ Facture créée en statut `received`, matching 3-way déclenché |
| 5 | Vérifier Network | `POST /api/supplier-invoices` → HTTP 201 |
| 6 | Vérifier `ThreeWayMatchingStats` sur le dashboard | Total factures +1, badge "Reçues" incrémenté |

### TC-FI02 — N° de facture unique

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Créer avec un `invoiceNumber` déjà utilisé | ❌ Erreur d'unicité |

### TC-FI03 — Workflow de validation (3-way matching)

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Sur une facture en statut `received`, cliquer "Valider" | ✅ Statut → `validated`, badge bleu |
| 2 | Vérifier Network | `PATCH /api/supplier-invoices/:id/validate` → HTTP 200 |
| 3 | Cliquer "Approuver" | ✅ Statut → `approved`, badge cyan |
| 4 | Vérifier Network | `PATCH /api/supplier-invoices/:id/approve` → HTTP 200 |
| 5 | Enregistrer le paiement | ✅ Statut → `paid`, solde = 0 |
| 6 | Vérifier Network | `POST /api/supplier-invoices/:id/payment` → HTTP 200 |
| 7 | Vérifier `ThreeWayMatchingStats` | Taux de matching mis à jour |

### TC-FI04 — Facture avec écart (discrepancy)

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Créer une facture avec un montant différent de la commande liée | `hasDiscrepancy: true`, `variancePercentage` calculé |
| 2 | Vérifier que la facture est marquée avec un indicateur d'écart | Badge ou indicateur rouge visible |
| 3 | Vérifier `ThreeWayMatchingStats` → KPI "Écarts %" | Pourcentage augmenté |
| 4 | Marquer en `disputed` | ✅ Statut `disputed`, visible dans le filtre "Disputes" |

### TC-FI05 — Facture en retard (widget dashboard)

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Créer une facture avec `dueDate` = hier, statut non `paid` | — |
| 2 | Vérifier le widget `OverdueInvoicesAlert` sur le dashboard | ✅ Facture visible dans les alertes |
| 3 | Enregistrer le paiement | ✅ Disparaît des alertes |

---

## 10 — Factures clients / Facturation

🔗 *Prérequis : mission existante en statut `completed` ou `delivered`*

### TC-FC01 — Génération d'une facture client

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Menu « Facturation client » > onglet « Factures clients » | Liste des factures clients |
| 2 | Cliquer "Générer une facture" | Formulaire ou sélecteur de mission |
| 3 | Sélectionner une mission complétée, saisir le montant HT | — |
| 4 | Valider | ✅ Facture générée avec N° auto-incrémenté, statut `pending` |
| 5 | Vérifier Network | `POST /api/billing/invoices/generate` → HTTP 201 |
| 6 | Vérifier `ClientRevenueChart` sur le dashboard Financier | Montant reflété dans le bar chart du client concerné |

### TC-FC02 — Enregistrement d'un paiement

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Ouvrir une facture en statut `pending` | — |
| 2 | Cliquer "Enregistrer un paiement" | Formulaire : montant, méthode (virement, espèces, chèque, mobile money, autre), date |
| 3 | Saisir un paiement **partiel** | ✅ Statut → `partial`, solde restant affiché |
| 4 | Vérifier Network | `POST /api/billing/invoices/:id/payments` → HTTP 200 |
| 5 | Saisir le solde restant | ✅ Statut → `paid` |

### TC-FC03 — Téléchargement PDF

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Sur une facture, cliquer "Télécharger PDF" | Fichier PDF téléchargé |
| 2 | Ouvrir le PDF | Facture lisible : numéro, client, missions, montants HT/TVA/TTC, solde |
| 3 | Vérifier Network | `GET /api/billing/invoices/:id/pdf` → HTTP 200, `Content-Type: application/pdf` |

### TC-FC04 — Facture en retard (statut overdue)

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Créer une facture avec `dueDate` passée, non payée | ✅ Statut automatiquement `overdue` (ou marqué en rouge) |
| 2 | Vérifier l'affichage | Badge rouge "En retard" visible |

---

## 11 — Tests d'intégrité inter-entités

Ces tests vérifient que les suppressions et modifications en cascade sont correctes.

### TC-X01 — Suppression d'un véhicule référencé dans un WO

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Créer un work order pour le véhicule A | WO lié à véhicule A |
| 2 | Tenter de supprimer le véhicule A | ❌ Erreur "Véhicule utilisé dans des work orders" ou soft delete |
| 3 | Fermer/compléter le WO puis supprimer le véhicule | ✅ Suppression autorisée |

### TC-X02 — Suppression d'un fournisseur avec commandes

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Désactiver un fournisseur ayant des commandes d'achat actives | Fournisseur désactivé (soft delete), commandes toujours visibles |
| 2 | Vérifier que les commandes existantes restent accessibles | ✅ Historique préservé |

### TC-X03 — Mission → Facture → Dashboard cohérence

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Créer une mission pour le client `SOFITEX SA`, la compléter | Mission `completed` |
| 2 | Générer la facture client correspondante (montant `500 000 FCFA`) | Facture créée |
| 3 | Vérifier le `ClientRevenueChart` sur le dashboard | `SOFITEX SA` apparaît ou voit son montant augmenter |
| 4 | Enregistrer le paiement complet | Statut `paid`, solde = 0 |

### TC-X04 — WO → Sortie stock → Feed activité

| Étape | Action | Résultat attendu |
|-------|--------|-----------------|
| 1 | Créer un work order | — |
| 2 | Enregistrer une sortie de pièce liée à ce WO (`workOrderId` renseigné) | ✅ Sortie enregistrée |
| 3 | Vérifier le feed "Mouvements stock" du dashboard | ✅ Sortie visible avec raison liée au WO |
| 4 | Vérifier que le stock de la pièce a diminué | ✅ Quantité réduite |

---

## Matrice de couverture CRUD

| Entité | Create | Read (list) | Read (détail) | Update | Delete | Cas erreur | Lien dashboard |
|--------|--------|-------------|---------------|--------|--------|-----------|---------------|
| Véhicules | TC-V01 | TC-V03 | TC-V03 | TC-V04 | TC-V05 | TC-V02 | TC-V06, TC-101 |
| Chauffeurs | TC-D01 | TC-D03 | TC-D03 | TC-D04 | TC-D04 | TC-D02 | TC-202 |
| Pièces | TC-P01 | TC-P06 | — | TC-P06 | TC-P06 | TC-P02 | TC-102, TC-404 |
| Mvt. stock | TC-P03/04 | TC-404 | — | — | — | TC-P04 | TC-404 |
| Fournisseurs | TC-S01 | TC-S04 | TC-S03 | TC-S03 | TC-S04 | TC-S02 | TC-501 |
| Clients | TC-C01 | TC-C03 | — | TC-C03 | TC-C03 | TC-C02 | TC-104 |
| Work Orders | TC-WO01 | TC-WO04 | — | TC-WO04 | TC-WO04 | TC-WO02 | TC-402 |
| Missions | TC-M01 | TC-M04 | — | TC-M03 | TC-M04 | TC-M02 | TC-403 |
| Cdes achat | TC-PO01 | TC-PO03 | — | TC-PO02 | — | — | TC-204 |
| Fact. fourn. | TC-FI01 | TC-FI05 | TC-FI03 | TC-FI03 | — | TC-FI02 | TC-203, TC-502 |
| Fact. client | TC-FC01 | TC-FC04 | TC-FC03 | TC-FC02 | — | — | TC-104, TC-503 |

---

*Document généré le 2026-02-19 — FleetMaster 2.0 / Trigenys Group*
*À exécuter en complément de QA-DASHBOARD-ADMIN.md*
