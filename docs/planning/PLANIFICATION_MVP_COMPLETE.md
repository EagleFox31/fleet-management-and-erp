# 🎯 PLANIFICATION COMPLÈTE MVP - YARO FLEETOS
## Roadmap de A à Z pour un MVP Opérationnel

**Date de création :** 6 octobre 2025  
**Dernière mise à jour :** 21 octobre 2025  
**Objectif :** Système de gestion de flotte complet et autonome  
**État actuel :** Phase 1 Procurement (90%) + Phase 2 Facturation Clients démarrée

### 📌 **PROGRESSION ACTUELLE - PHASE 1**
- ✅ **Sous-étape 1.1.1** : Fiches Fournisseurs Complètes (100%) - **COMPLÉTÉ**
- ⚠️ **Sous-étape 1.1.2** : Système Commandes Groupées (90%) - **EN COURS**
  - ✅ Base de données & Backend complets
  - ✅ Interfaces de création/gestion/suivi
  - ✅ Regroupement automatique & remises volume
  - ✅ Alertes retards livraison avec code de livraison
  - ❌ Automatisations (cron jobs, emails fournisseurs) - **À FAIRE**
- ✅ **Sous-étape 1.1.3** : Workflow Factures Fournisseurs (100%) - **COMPLÉTÉ**
  - ✅ Table supplierInvoices avec contrôle 3 voies
  - ✅ Service ThreeWayMatchingService complet
  - ✅ API Routes avec workflow validation hiérarchique
  - ✅ Interfaces utilisateur complètes (liste, détails, écarts)
  - ✅ Export Excel et statistiques
- ⏳ **Sous-étape 1.1.4** : Interface Procurement Complète - **À VENIR**

### 📌 **PROGRESSION ACTUELLE - PHASE 2**
- ⏳ **Sous-étape 2.1.1** : Gestion Fiches Clients - **À VENIR**
- ✅ **Sous-étape 2.1.2** : Création Factures Clients (100%) - **COMPLÉTÉ**
  - ✅ Schéma base de données `client_invoices` opérationnel
  - ✅ API Routes complètes (création, liste, détails, PDF)
  - ✅ Interface navigation cliquable (liste → détails)
  - ✅ Génération PDF avec téléchargement
  - ✅ Calcul TVA 19.25% automatique
  - ✅ Numérotation automatique avec verrous PostgreSQL
  - ✅ Tests e2e validés
- ✅ **Sous-étape 2.1.3** : Suivi Paiements & Relances (100%) - **COMPLÉTÉ**
  - ✅ Table `invoice_payments` opérationnelle
  - ✅ Workflow enregistrement paiements
  - ✅ Calcul automatique balance/statuts
  - ✅ Dashboard analytique avec KPIs
- ⏳ **Sous-étape 2.1.4** : Rapports Chiffre d'Affaires - **À VENIR**

---

## 📊 ÉTAT ACTUEL - BASE EXISTANTE

### ✅ **MODULES OPÉRATIONNELS (82%)**

| Module | Avancement | État |
|--------|------------|------|
| Flotte & Documents | 90% | ✅ Opérationnel |
| Maintenance & Stock | 95% | ✅ Opérationnel |
| Personnel/Habilitations | 80% | ✅ Fonctionnel |
| Gestion Carburant | 85% | ✅ Opérationnel |
| **Fournisseurs & Achats** | **90%** | ⚠️ **En cours** |

### 🎯 **BÉNÉFICES DÉJÀ MESURÉS**
- ✅ 90% gain temps documentation
- ✅ 300% productivité maintenance
- ✅ 15-20% économies carburant
- ✅ Traçabilité parfaite véhicules/documents/interventions

---

## 🚀 PHASES DE DÉVELOPPEMENT MVP

### **PHASE 1 : FINALISATION LOT 1**
**Durée : 2-3 mois**  
**Objectif : Compléter la base opérationnelle à 90%+**

### **PHASE 2 : MODULES BUSINESS CRITIQUES**
**Durée : 6-8 mois**  
**Objectif : Facturation, Opérations, Trésorerie**

### **PHASE 3 : OPTIMISATION & PERFECTIONNEMENT**
**Durée : 3-4 mois**  
**Objectif : Dashboards avancés, Workflows automatisés, Analytics**

---

## 📋 PHASE 1 : FINALISATION LOT 1 (2-3 mois)

### **ÉTAPE 1.1 : Module Fournisseurs & Achats (30% → 90%)**
**Durée : 10 semaines**

#### **Sous-étape 1.1.1 : Fiches Fournisseurs Complètes** ✅ **COMPLÉTÉ**
**Durée : 3 semaines** | **Date achèvement : 7 octobre 2025**

**Tâches :**
1. ✅ **Schéma base de données**
   - ✅ Créer table `suppliers` enrichie
   - ✅ Ajouter champs : `companyName`, `contactName`, `email`, `phone`
   - ✅ Ajouter `siret`, `deliveryTerms`, `notes`
   - ✅ Ajouter ratings : `qualityRating`, `reliabilityRating`, `priceCompetitiveness`
   - ✅ Statut `isActive` pour archivage

2. ✅ **Service backend**
   - ✅ Créer `SupplierManagementService.ts`
   - ✅ Méthodes CRUD : `createSupplier()`, `updateSupplier()`, `deleteSupplier()`
   - ✅ Méthode `getSupplierPerformance()` pour évaluations
   - ✅ Méthode `calculateRatings()` avec statistiques

3. ✅ **API Routes**
   - ✅ `POST /api/suppliers` - Création
   - ✅ `GET /api/suppliers` - Liste avec filtres (search, category, isActive)
   - ✅ `GET /api/suppliers/:id` - Détails + statistiques
   - ✅ `PATCH /api/suppliers/:id` - Mise à jour
   - ✅ `DELETE /api/suppliers/:id` - Soft delete (désactivation)
   - ✅ `PATCH /api/suppliers/:id/reactivate` - Réactivation
   - ✅ `GET /api/suppliers/top` - Top 5 fournisseurs

4. ✅ **Interface utilisateur**
   - ✅ Page `/procurement/suppliers/` - Liste fournisseurs avec filtres
   - ✅ Page `/procurement/suppliers/new` - Création
   - ✅ Page `/procurement/suppliers/:id` - Détails + performance
   - ✅ Système étoiles pour ratings (1-5)
   - ✅ Formulaire avec validation Zod

5. ✅ **Migration données**
   - ✅ Script migration champ `supplier` → table `suppliers`
   - ✅ 22 fournisseurs migrés avec succès
   - ✅ Nettoyage doublons et normalisation

**Livrables :**
- ✅ Table `suppliers` opérationnelle
- ✅ 22 fournisseurs existants migrés
- ✅ Interface gestion complète
- ✅ Système évaluation performance avec contrôle d'accès par rôle

---

#### **Sous-étape 1.1.2 : Système Commandes Groupées** ⚠️ **EN COURS (90%)**
**Durée : 3 semaines** | **Démarré : 7 octobre 2025**

**Tâches :**
1. ✅ **Schéma base de données**
   - ✅ Créer table `purchaseOrders`
   - ✅ Champs : `orderNumber`, `supplierId`, `orderDate`, `expectedDeliveryDate`
   - ✅ Statuts : draft, sent, confirmed, partial, delivered, completed, cancelled
   - ✅ Créer table `purchaseOrderLines` (lignes commande)
   - ✅ Relation avec `partRequirements` pour traçabilité complète

2. ✅ **Service backend**
   - ✅ Créer `ProcurementService.ts`
   - ✅ Méthode `groupRequestsBySupplier()` - Regroupement intelligent
   - ✅ Méthode `createPurchaseOrder()` - Génération commande + lignes manuelles
   - ✅ Méthode `optimizeOrderTiming()` - Regroupement temporel
   - ✅ Méthode `calculateVolumeDiscounts()` - Calcul remises 5-10%

3. ✅ **API Routes**
   - ✅ `POST /api/purchase-orders` - Création (hybride: requirements + manual)
   - ✅ `GET /api/purchase-orders` - Liste avec filtres
   - ✅ `GET /api/purchase-orders/:id` - Détails
   - ✅ `PATCH /api/purchase-orders/:id/status` - Changement statut
   - ✅ `GET /api/purchase-orders/group-suggestions` - Regroupement auto
   - ✅ `GET /api/purchase-orders/optimize-timing/:supplierId` - Optimisation temporelle
   - ✅ `GET /api/purchase-orders/statistics` - Statistiques économies

4. ✅ **Interface utilisateur**
   - ✅ Page `/procurement/orders/` - Liste commandes avec KPIs temps réel
   - ✅ Page `/procurement/orders/new` - Création hybride (requirements + manuel)
   - ✅ Page `/procurement/orders/:id` - Détails + suivi statuts
   - ✅ Page `/procurement/orders/group` - Dashboard regroupement automatique
   - ✅ Workflow validation (admin/workshop_manager)
   - ✅ Contrôle d'accès granulaire par rôle

5. ⚠️ **Automatisation** (PARTIEL)
   - ❌ Cron job regroupement hebdomadaire demandes
   - ❌ Notifications fournisseurs par email
   - ✅ Alertes retards livraison

**Livrables :**
- ✅ Système commandes opérationnel (création, validation, suivi)
- ✅ Regroupement automatique par fournisseur avec suggestions
- ✅ Workflow validation hiérarchique (admin/workshop_manager)
- ✅ Création hybride : demandes approuvées + articles manuels
- ✅ Calcul remises volume (5-10%) automatique
- ✅ Traçabilité complète (part requirements → order lines)
- ✅ Alertes retards livraison avec code de livraison obligatoire
- ❌ **Automatisations restantes** (cron jobs, emails fournisseurs) - Phase suivante

---

#### **Sous-étape 1.1.3 : Workflow Factures Fournisseurs** ✅ **COMPLÉTÉ**
**Durée : 2 semaines** | **Date achèvement : 21 octobre 2025**

**Tâches :**
1. ✅ **Schéma base de données**
   - ✅ Créer table `supplierInvoices`
   - ✅ Champs : `invoiceNumber`, `supplierId`, `purchaseOrderId`
   - ✅ Montants : `subtotal`, `taxAmount`, `totalAmount`, `amountHT`, `vatAmount`, `totalTTC`, `balance`
   - ✅ Statuts : received, validated, approved, paid, disputed
   - ✅ Tracking : `validatedBy`, `validatedAt`, `approvedBy`, `approvedAt`, `paidBy`, `paidDate`
   - ✅ Champs contrôle 3 voies : `priceVariance`, `quantityVariance`, `variancePercentage`, `hasDiscrepancy`, `discrepancyNotes`

2. ✅ **Service backend**
   - ✅ Créer `ThreeWayMatchingService.ts`
   - ✅ Méthode `validateInvoiceAgainstOrder()` - Contrôle 3 voies complet
   - ✅ Méthode `detectPriceVariances()` - Détection écarts avec calcul variancePercentage
   - ✅ Méthode `autoApproveMatches()` - Approbation auto si match parfait (recommendation: 'auto_approve')
   - ✅ Méthode `escalateDiscrepancies()` - Escalade si écart >=5% (recommendation: 'escalate')
   - ✅ Méthode `getSupplierInvoices()` - Liste avec filtres
   - ✅ Méthode `createSupplierInvoice()` - Création facture
   - ✅ Méthode `validateInvoice()` - Validation technique
   - ✅ Méthode `approveInvoice()` - Approbation hiérarchique
   - ✅ Méthode `recordPayment()` - Enregistrement paiement

3. ✅ **API Routes**
   - ✅ `POST /api/supplier-invoices` - Création/Upload
   - ✅ `GET /api/supplier-invoices` - Liste avec filtres (status, supplierId, hasDiscrepancy, dates)
   - ✅ `GET /api/supplier-invoices/:id` - Détails complets
   - ✅ `PATCH /api/supplier-invoices/:id/validate` - Validation technique
   - ✅ `PATCH /api/supplier-invoices/:id/approve` - Approbation hiérarchique
   - ✅ `POST /api/supplier-invoices/:id/payment` - Enregistrer paiement
   - ✅ `GET /api/supplier-invoices/statistics` - Statistiques globales
   - ✅ Contrôle d'accès par rôle (admin, workshop_manager, secretary)

4. ✅ **Interface utilisateur**
   - ✅ Page `/procurement/invoices/` - Liste factures avec filtres
   - ✅ Page `/procurement/invoices/new` - Création facture
   - ✅ Page `/procurement/invoices/:id` - Détails + contrôle 3 voies
   - ✅ Page `/procurement/invoices/discrepancies` - Dashboard écarts à traiter
   - ✅ Workflow approbation visuel avec statuts
   - ✅ Alertes factures en retard (dans dashboard)
   - ✅ Navigation sidebar pour tous les rôles autorisés

5. ✅ **Intégrations**
   - ⏳ OCR factures PDF (optionnel - à venir)
   - ✅ Export comptabilité Excel via ExcelExportService
   - ✅ Rapports synthèse fournisseurs

**Livrables :**
- ✅ Contrôle 3 voies automatique (comparaison facture ↔ commande)
- ✅ Workflow validation hiérarchique (validation technique → approbation → paiement)
- ✅ Détection écarts >=5% avec escalade automatique
- ✅ Traçabilité paiements complète (userId, dates, montants)
- ✅ Interface complète pour gestion factures fournisseurs
- ✅ Export Excel et statistiques avancées

---

#### **Sous-étape 1.1.4 : Interface Procurement Complète**
**Durée : 2 semaines**

**Tâches :**
1. **Dashboard Procurement**
   - KPIs : Total achats, économies réalisées, délais moyens
   - Top 5 fournisseurs par volume
   - Alertes commandes en retard
   - Graphiques évolution achats

2. **Pages gestion**
   - Vue synthèse `/procurement/dashboard`
   - Gestion fournisseurs `/procurement/suppliers`
   - Gestion commandes `/procurement/orders`
   - Gestion factures `/procurement/invoices`
   - Rapports performance `/procurement/reports`

3. **Rapports avancés**
   - Performance fournisseurs (qualité, délais, prix)
   - Analyse coûts par catégorie pièces
   - Prévisions besoins achats
   - Export Excel/PDF

4. **Notifications temps réel**
   - WebSocket pour mises à jour statuts
   - Alertes email validations en attente
   - Rappels échéances paiements

**Livrables :**
- ✅ Dashboard procurement KPIs
- ✅ 4 pages gestion complètes
- ✅ Système rapports avancés
- ✅ Notifications temps réel

---

### **ÉTAPE 1.2 : Compléter Module Personnel (80% → 95%)**
**Durée : 4 semaines**

#### **Sous-étape 1.2.1 : Module QHSE**
**Durée : 2 semaines**

**Tâches :**
1. **Schéma base de données**
   - Table `trainings` - Formations
   - Table `certifications` - Certifications/habilitations
   - Table `training_sessions` - Sessions formation
   - Relation avec `drivers` et `users`

2. **Service backend**
   - `QHSEService.ts`
   - Suivi formations obligatoires
   - Alertes renouvellements certifications
   - Statistiques conformité

3. **Interface**
   - Dashboard QHSE
   - Planning formations
   - Suivi certifications individuelles

**Livrables :**
- ✅ Suivi formations QHSE
- ✅ Alertes certifications
- ✅ Conformité réglementaire

---

#### **Sous-étape 1.2.2 : Gestion Permis de Conduire**
**Durée : 1 semaine**

**Tâches :**
1. **Enrichissement schéma**
   - Ajouter `drivingLicenseExpiry` dans `drivers`
   - Catégories permis : C, CE, D, etc.
   - Upload scan permis

2. **Alertes automatiques**
   - 60 jours avant expiration permis
   - Suspension activité si expiré
   - Notifications chauffeur + admin

**Livrables :**
- ✅ Suivi validité permis
- ✅ Alertes expiration
- ✅ Documents sécurisés

---

#### **Sous-étape 1.2.3 : Planning Équipes & Congés**
**Durée : 1 semaine**

**Tâches :**
1. **Schéma base de données**
   - Table `leave_requests` - Demandes congés
   - Statuts : pending, approved, rejected
   - Types : vacation, sick, training

2. **Interface**
   - Calendrier équipes
   - Demandes congés
   - Validation hiérarchique

**Livrables :**
- ✅ Gestion congés
- ✅ Planning visuel équipes

---

### **BILAN PHASE 1**
**Durée totale : 14 semaines (3,5 mois)**

**Modules finalisés :**
- ✅ Fournisseurs & Achats : 30% → 90%
- ✅ Personnel : 80% → 95%

**ROI Phase 1 :**
- 5-10% économies achats (regroupement, négociations)
- Conformité QHSE à 95%
- Base LOT 1 complète et opérationnelle

---

## 💼 PHASE 2 : MODULES BUSINESS CRITIQUES (6-8 mois)

### **ÉTAPE 2.1 : Module Facturation & Clients (0% → 90%)**
**Durée : 20 semaines**

#### **Sous-étape 2.1.1 : Gestion Fiches Clients**
**Durée : 3 semaines**

**Tâches :**
1. **Schéma base de données**
   - Créer table `clients`
   - Champs : `companyName`, `contactName`, `email`, `phone`
   - Adresse facturation/livraison
   - Conditions paiement : `paymentTerms` (30, 60, 90 jours)
   - Statut `isActive`, `creditLimit`

2. **Service backend**
   - `ClientManagementService.ts`
   - CRUD clients
   - Calcul encours client
   - Historique opérations

3. **API Routes**
   - `POST /api/clients` - Création
   - `GET /api/clients` - Liste
   - `GET /api/clients/:id` - Détails + historique
   - `PATCH /api/clients/:id` - Mise à jour

4. **Interface**
   - Page `/billing/clients/` - Liste clients
   - Page `/billing/clients/new` - Création
   - Page `/billing/clients/:id` - Détails + onglets
   - Dashboard top clients

5. **Migration données**
   - Identifier clients existants (MAERSK, CNPCC, AGL, SODECOTON)
   - Créer fiches avec données historiques

**Livrables :**
- ✅ Table `clients` opérationnelle
- ✅ Fiches clients existants créées
- ✅ Interface gestion complète

---

#### **Sous-étape 2.1.2 : Création Factures Clients** ✅ **COMPLÉTÉ**
**Durée : 4 semaines** | **Date achèvement : 21 octobre 2025**

**Tâches :**
1. **Schéma base de données**
   - Créer table `client_invoices`
   - Champs : `invoiceNumber`, `clientId`, `invoiceDate`, `dueDate`
   - Montants : `subtotal`, `vatAmount` (19.25%), `totalAmount`
   - Statuts : draft, sent, partial, paid, overdue, cancelled
   - Relation avec opérations/missions

2. **Service backend**
   - `BillingService.ts`
   - Méthode `generateInvoiceNumber()` - Numérotation auto
   - Méthode `calculateVAT()` - TVA 19.25%
   - Méthode `createInvoiceFromOperations()` - Facturation missions
   - Méthode `sendInvoiceByEmail()` - Envoi client

3. **API Routes**
   - `POST /api/client-invoices` - Création
   - `GET /api/client-invoices` - Liste avec filtres
   - `GET /api/client-invoices/:id` - Détails
   - `PATCH /api/client-invoices/:id` - Mise à jour
   - `POST /api/client-invoices/:id/send` - Envoi email
   - `GET /api/client-invoices/:id/pdf` - Génération PDF

4. **Interface utilisateur**
   - Page `/billing/invoices/` - Liste factures
   - Page `/billing/invoices/new` - Création manuelle
   - Page `/billing/invoices/:id` - Détails + édition
   - Formulaire saisie lignes facture
   - Calcul automatique TVA/totaux

5. **Génération PDF**
   - Template facture professionnel
   - Logo entreprise, mentions légales
   - Récapitulatif TVA
   - Export multi-factures

**Livrables :**
- ✅ Création factures clients
- ✅ Calcul TVA 19.25% auto
- ✅ Génération PDF professionnelle
- ✅ Numérotation automatique

---

#### **Sous-étape 2.1.3 : Suivi Paiements & Relances**
**Durée : 3 semaines**

**Tâches :**
1. **Schéma base de données**
   - Créer table `payments`
   - Champs : `invoiceId`, `amount`, `paymentDate`, `paymentMethod`
   - Statut paiement partiel/complet
   - Table `payment_reminders` - Relances

2. **Service backend**
   - `PaymentService.ts`
   - Méthode `recordPayment()` - Enregistrement paiement
   - Méthode `calculateOutstanding()` - Calcul impayés
   - Méthode `generateReminders()` - Relances automatiques
   - Niveaux relance : J+7, J+15, J+30 après échéance

3. **API Routes**
   - `POST /api/payments` - Enregistrer paiement
   - `GET /api/payments` - Historique
   - `GET /api/client-invoices/overdue` - Factures en retard
   - `POST /api/payments/reminders/send` - Envoyer relances

4. **Interface**
   - Page `/billing/payments/` - Suivi paiements
   - Dashboard impayés
   - Système relances automatiques
   - États de compte clients

5. **Automatisation**
   - Cron job relances automatiques
   - Emails relances J+7, J+15, J+30
   - Alertes admin encours dépassé

**Livrables :**
- ✅ Suivi paiements complet
- ✅ Relances automatiques 3 niveaux
- ✅ Dashboard impayés
- ✅ États compte clients

---

#### **Sous-étape 2.1.4 : Rapports Chiffre d'Affaires**
**Durée : 2 semaines**

**Tâches :**
1. **Analytics & Reporting**
   - Rapport CA par client/période
   - Évolution CA mensuelle/annuelle
   - Top clients par CA
   - Analyse rentabilité par client

2. **Interface rapports**
   - Page `/billing/reports/` - Centre rapports
   - Filtres période, client, statut
   - Graphiques CA
   - Export Excel/PDF

3. **Dashboards**
   - KPIs : CA total, impayés, taux recouvrement
   - Prévisions CA basées historique
   - Alertes objectifs CA

**Livrables :**
- ✅ Rapports CA complets
- ✅ Analytics avancés
- ✅ Prévisions CA

---

#### **Sous-étape 2.1.5 : Intégration Comptabilité**
**Durée : 2 semaines**

**Tâches :**
1. **Export comptable**
   - Format FEC (Fichier Écritures Comptables)
   - Export périodique factures/paiements
   - Journaux comptables

2. **Réconciliation**
   - Rapprochement factures/paiements
   - Lettrage automatique

**Livrables :**
- ✅ Export FEC
- ✅ Intégration comptable

---

#### **Sous-étape 2.1.6 : Module Secrétaire - Interface Complète**
**Durée : 2 semaines**

**Tâches :**
1. **Dashboard secrétaire enrichi**
   - Onglet Facturation
   - Onglet Suivi paiements
   - Onglet Relances
   - Saisie rapide factures

2. **Workflows optimisés**
   - Création facture en 3 clics
   - Import opérations → facture auto
   - Envoi email clients intégré

**Livrables :**
- ✅ Dashboard secrétaire complet
- ✅ Workflows optimisés facturation

---

#### **Sous-étape 2.1.7 : Tests & Validation**
**Durée : 2 semaines**

**Tâches :**
1. **Tests unitaires**
   - Service calculs TVA
   - Génération numéros factures
   - Relances automatiques

2. **Tests intégration**
   - Workflow complet facturation
   - Paiements et lettrage
   - Exports comptables

3. **Tests utilisateurs**
   - Validation secrétaire
   - Formation équipe

**Livrables :**
- ✅ Module testé et validé
- ✅ Équipe formée

---

#### **Sous-étape 2.1.8 : Déploiement & Monitoring**
**Durée : 2 semaines**

**Tâches :**
1. **Mise en production**
   - Migration données existantes
   - Configuration emails
   - Paramétrage numérotation

2. **Monitoring**
   - Alertes erreurs facturation
   - Suivi performances
   - Logs détaillés

**Livrables :**
- ✅ Module facturation production
- ✅ Monitoring actif

---

### **ÉTAPE 2.2 : Module Gestion Opérations (0% → 90%)**
**Durée : 16 semaines**

#### **Sous-étape 2.2.1 : Gestion Missions/Opérations**
**Durée : 4 semaines**

**Tâches :**
1. **Schéma base de données**
   - Créer table `operations`
   - Champs : `operationNumber`, `clientId`, `vehicleId`, `driverId`
   - Dates : `startDate`, `endDate`, `estimatedDate`
   - Localisation : `origin`, `destination`, `distance`
   - Statuts : planned, in_progress, completed, cancelled

2. **Service backend**
   - `OperationsService.ts`
   - Méthode `createOperation()` - Création mission
   - Méthode `assignVehicleAndDriver()` - Affectation ressources
   - Méthode `calculateEstimatedCost()` - Coûts prévisionnels
   - Méthode `trackOperationStatus()` - Suivi temps réel

3. **API Routes**
   - `POST /api/operations` - Création
   - `GET /api/operations` - Liste avec filtres
   - `GET /api/operations/:id` - Détails
   - `PATCH /api/operations/:id` - Mise à jour
   - `PATCH /api/operations/:id/status` - Changement statut
   - `GET /api/operations/by-client/:clientId` - Par client

4. **Interface utilisateur**
   - Page `/operations/` - Liste opérations
   - Page `/operations/new` - Création mission
   - Page `/operations/:id` - Détails + suivi
   - Calendrier missions
   - Dashboard logisticien

**Livrables :**
- ✅ Gestion missions complète
- ✅ Affectation véhicules/chauffeurs
- ✅ Suivi statuts temps réel

---

#### **Sous-étape 2.2.2 : Planification Missions Quotidiennes**
**Durée : 3 semaines**

**Tâches :**
1. **Service planification**
   - `MissionPlanningService.ts`
   - Méthode `getDailySchedule()` - Planning du jour
   - Méthode `optimizeRoutes()` - Optimisation itinéraires
   - Méthode `checkVehicleAvailability()` - Disponibilité véhicules
   - Méthode `checkDriverAvailability()` - Disponibilité chauffeurs

2. **Interface planning**
   - Page `/operations/planning/` - Vue calendrier
   - Vue jour/semaine/mois
   - Drag & drop affectations
   - Détection conflits horaires

3. **Optimisation**
   - Algorithme optimisation routes
   - Regroupement missions même destination
   - Minimisation kilométrage à vide

**Livrables :**
- ✅ Planning missions quotidien
- ✅ Optimisation routes
- ✅ Gestion conflits

---

#### **Sous-étape 2.2.3 : Calcul Coûts Missions (Carburant + FDR)**
**Durée : 3 semaines**

**Tâches :**
1. **Schéma base de données**
   - Créer table `operation_costs`
   - Champs : `operationId`, `fuelCost`, `fdrCost`, `tollCost`
   - Coûts réels vs estimés
   - Calcul marge

2. **Service calcul**
   - `OperationCostService.ts`
   - Méthode `calculateFuelCost()` - Carburant estimé
   - Méthode `calculateFDR()` - Frais De Route
   - Méthode `calculateTotalCost()` - Coût total
   - Méthode `calculateMargin()` - Marge opération

3. **Paramétrage**
   - Tarifs FDR par destination
   - Consommation moyenne par type véhicule
   - Prix carburant actuel
   - Table `destination_rates` - Tarifs par trajet

4. **Interface**
   - Formulaire saisie tarifs FDR
   - Calculatrice coûts missions
   - Rapports écarts réel/estimé

**Livrables :**
- ✅ Calcul automatique coûts
- ✅ Carburant + FDR par mission
- ✅ Analyse marges

---

#### **Sous-étape 2.2.4 : Suivi Opérations par Client**
**Durée : 2 semaines**

**Tâches :**
1. **Dashboards clients**
   - Vue par client (MAERSK, CNPCC, etc.)
   - Missions en cours/terminées
   - Statistiques performances
   - Historique complet

2. **Rapports opérationnels**
   - Missions par période
   - Rentabilité par client
   - Taux respect délais
   - KPIs opérationnels

**Livrables :**
- ✅ Dashboard par client
- ✅ Rapports opérationnels

---

#### **Sous-étape 2.2.5 : Module Logisticien - Interface Complète**
**Durée : 2 semaines**

**Tâches :**
1. **Dashboard logisticien**
   - Planning missions du jour
   - Créer mission rapide
   - Affecter ressources
   - Suivi missions en cours

2. **Workflows optimisés**
   - Création mission en 2 minutes
   - Calcul auto carburant + FDR
   - Notification chauffeurs SMS/email

**Livrables :**
- ✅ Dashboard logisticien complet
- ✅ Création mission optimisée

---

#### **Sous-étape 2.2.6 : Intégration avec Facturation**
**Durée : 1 semaine**

**Tâches :**
1. **Lien missions → factures**
   - Facturation automatique depuis missions
   - Regroupement missions par client/période
   - Import missions dans facture

2. **Interface**
   - Bouton "Facturer missions" sur dashboard
   - Sélection missions à facturer
   - Génération facture auto

**Livrables :**
- ✅ Facturation depuis missions
- ✅ Workflow intégré

---

#### **Sous-étape 2.2.7 : Tests & Déploiement**
**Durée : 1 semaine**

**Tâches :**
1. **Tests complets**
   - Workflow création mission
   - Calculs coûts
   - Intégration facturation

2. **Formation**
   - Formation logisticien
   - Documentation workflows

**Livrables :**
- ✅ Module opérations production
- ✅ Équipe formée

---

### **ÉTAPE 2.3 : Module Trésorerie & Comptabilité (0% → 90%)**
**Durée : 12 semaines**

#### **Sous-étape 2.3.1 : Gestion Encaissements/Décaissements**
**Durée : 3 semaines**

**Tâches :**
1. **Schéma base de données**
   - Créer table `treasury_transactions`
   - Types : encaissement, décaissement
   - Catégories : vente, achat, salaire, charge, investissement
   - Relation avec factures clients/fournisseurs

2. **Service backend**
   - `TreasuryService.ts`
   - Enregistrement transactions
   - Rapprochement bancaire
   - Prévisions flux

3. **Interface**
   - Saisie encaissements/décaissements
   - Journal trésorerie
   - Catégorisation automatique

**Livrables :**
- ✅ Gestion transactions
- ✅ Catégorisation automatique

---

#### **Sous-étape 2.3.2 : Suivi Soldes Bancaires Multi-Comptes**
**Durée : 3 semaines**

**Tâches :**
1. **Schéma base de données**
   - Créer table `bank_accounts`
   - Soldes temps réel par compte
   - Historique mouvements

2. **Service**
   - Mise à jour soldes automatique
   - Alertes découvert
   - Réconciliation bancaire

3. **Interface**
   - Dashboard multi-comptes
   - Graphiques évolution soldes
   - Import relevés bancaires

**Livrables :**
- ✅ Suivi multi-comptes
- ✅ Alertes découvert
- ✅ Réconciliation bancaire

---

#### **Sous-étape 2.3.3 : Prévisions Trésorerie**
**Durée : 2 semaines**

**Tâches :**
1. **Algorithme prévisionnel**
   - Calcul flux prévisionnels
   - Basé sur factures échues
   - Basé sur historique

2. **Interface**
   - Graphiques prévisions 3/6/12 mois
   - Scénarios optimiste/pessimiste
   - Alertes tension trésorerie

**Livrables :**
- ✅ Prévisions trésorerie
- ✅ Alertes anticipées

---

#### **Sous-étape 2.3.4 : Intégration Comptabilité**
**Durée : 2 semaines**

**Tâches :**
1. **Export FEC global**
   - Toutes écritures comptables
   - Format normalisé
   - Export périodique

2. **Rapports comptables**
   - Grand livre
   - Balance générale
   - Compte de résultat simplifié

**Livrables :**
- ✅ Exports comptables
- ✅ Rapports réglementaires

---

#### **Sous-étape 2.3.5 : Dashboard Financier Direction**
**Durée : 1 semaine**

**Tâches :**
1. **KPIs financiers**
   - CA réalisé vs prévisionnel
   - Trésorerie nette
   - Encours clients/fournisseurs
   - Rentabilité globale

2. **Interface executive**
   - Vue synthétique direction
   - Graphiques performances
   - Alertes criticité

**Livrables :**
- ✅ Dashboard direction
- ✅ Pilotage stratégique

---

#### **Sous-étape 2.3.6 : Tests & Déploiement**
**Durée : 1 semaine**

**Tâches :**
- Tests complets module trésorerie
- Formation équipe financière
- Migration données bancaires

**Livrables :**
- ✅ Module trésorerie production

---

### **BILAN PHASE 2**
**Durée totale : 48 semaines (12 mois)**

**Modules développés :**
- ✅ Facturation & Clients : 0% → 90%
- ✅ Gestion Opérations : 0% → 90%
- ✅ Trésorerie & Comptabilité : 0% → 90%

**ROI Phase 2 :**
- 20-30% amélioration cash-flow (facturation/recouvrement)
- 15% gain efficacité opérationnelle (optimisation missions)
- Pilotage financier stratégique complet
- Autonomie totale entreprise

---

## 🎨 PHASE 3 : OPTIMISATION & PERFECTIONNEMENT (3-4 mois)

### **ÉTAPE 3.1 : Workflows Automatisés Avancés**
**Durée : 4 semaines**

#### **Sous-étape 3.1.1 : Automatisation Complète**

**Tâches :**
1. **Workflows développés**
   - Maintenance préventive auto
   - Réapprovisionnement stock auto
   - Alertes préventives multi-niveaux
   - Ordres travail urgents

2. **Triggers intelligents**
   - Seuils kilométrage → OT auto
   - Stock minimum → Commande auto
   - Expiration documents → Relances auto

**Livrables :**
- ✅ 7 workflows automatisés actifs
- ✅ Réduction 50% tâches manuelles

---

### **ÉTAPE 3.2 : Analytics & Business Intelligence**
**Durée : 4 semaines**

#### **Sous-étape 3.2.1 : Dashboards Avancés**

**Tâches :**
1. **Analytics avancés**
   - Prédictions IA consommation carburant
   - Analyse rentabilité par véhicule
   - Optimisation planning maintenance
   - Scoring performance chauffeurs

2. **Interface BI**
   - Dashboards interactifs
   - Drill-down analyses
   - Export rapports automatisés

**Livrables :**
- ✅ 5 dashboards BI avancés
- ✅ Prédictions IA actives

---

### **ÉTAPE 3.3 : Module Carburant Avancé (40% → 95%)**
**Durée : 4 semaines**

#### **Sous-étape 3.3.1 : Optimisation Achats Carburant**

**Tâches :**
1. **Intégration fournisseurs**
   - API stations partenaires
   - Cartes carburant électroniques
   - Facturation automatique

2. **Analyses avancées**
   - Comparaison prix stations
   - Optimisation approvisionnements
   - Prévisions budgets carburant

**Livrables :**
- ✅ Intégration cartes carburant
- ✅ 5-8% optimisation coûts

---

### **ÉTAPE 3.4 : Module Besoins Logistiques**
**Durée : 4 semaines**

#### **Sous-étape 3.4.1 : Maîtrise Coûts Prévisionnels**

**Tâches :**
1. **Budgets missions**
   - Calculs prévisionnels affinés
   - Marges cibles par type mission
   - Alertes dépassements budgets

2. **Optimisation**
   - Regroupement missions rentables
   - Refus missions non rentables
   - Négociations tarifs clients

**Livrables :**
- ✅ Budgets prévisionnels précis
- ✅ 5-10% réduction coûts

---

### **BILAN PHASE 3**
**Durée totale : 16 semaines (4 mois)**

**Modules perfectionnés :**
- ✅ 7 workflows automatisés
- ✅ Analytics & BI avancés
- ✅ Carburant avancé : 40% → 95%
- ✅ Besoins logistiques opérationnel

**ROI Phase 3 :**
- Automatisation 50% tâches répétitives
- 5-8% optimisation carburant supplémentaire
- 5-10% réduction coûts logistiques
- Prédictions IA actives

---

## 📊 SYNTHÈSE GLOBALE MVP

### **TIMELINE COMPLÈTE**

| Phase | Durée | Modules | Avancement |
|-------|-------|---------|------------|
| **État actuel** | - | LOT 1 Base | ✅ 76% |
| **Phase 1** | 3,5 mois | Finalisation LOT 1 | 76% → 92% |
| **Phase 2** | 12 mois | Business critiques | +3 modules |
| **Phase 3** | 4 mois | Perfectionnement | Workflows + BI |
| **TOTAL** | **19,5 mois** | **MVP Complet** | **100%** |

---

### **INVESTISSEMENT DÉVELOPPEMENT**

**Charge totale estimée : 78 semaines-développeur**

**Répartition :**
- Phase 1 : 14 semaines (3,5 mois)
- Phase 2 : 48 semaines (12 mois)
- Phase 3 : 16 semaines (4 mois)

**Avec 1 développeur :** 19,5 mois  
**Avec 2 développeurs :** 10 mois  
**Avec 3 développeurs :** 7 mois

---

### **ROI GLOBAL MVP**

#### **Gains Productivité**
- ✅ 90% gain temps documentation (déjà réalisé)
- ✅ 300% productivité maintenance (déjà réalisé)
- ✅ 15% gain efficacité opérationnelle (Phase 2)
- ✅ 50% réduction tâches manuelles (Phase 3)

#### **Économies Coûts**
- ✅ 15-20% économies carburant (déjà réalisé)
- ✅ 5-10% économies achats (Phase 1)
- ✅ 5-8% optimisation carburant (Phase 3)
- ✅ 5-10% réduction coûts missions (Phase 3)

#### **Amélioration Cash-Flow**
- ✅ 20-30% amélioration trésorerie (Phase 2)
- ✅ Pilotage financier optimal (Phase 2)
- ✅ Recouvrement automatisé (Phase 2)

#### **ROI Consolidé sur 3 ans**
- **Investissement :** 19,5 mois développement
- **Gains quantifiables :** 25-35% réduction coûts globaux
- **Cash-flow :** +20-30% amélioration
- **ROI :** Rentabilité en 12-18 mois

---

### **PRIORISATION RECOMMANDÉE**

#### **OPTION 1 : MVP MINIMAL (6 mois)**
✅ Phase 1 uniquement (3,5 mois)  
✅ Opérations basiques (2 mois)  
= Base opérationnelle complète

#### **OPTION 2 : MVP BUSINESS (12 mois)**
✅ Phase 1 (3,5 mois)  
✅ Facturation + Opérations (8,5 mois)  
= Autonomie commerciale

#### **OPTION 3 : MVP COMPLET (19,5 mois)** ⭐ **RECOMMANDÉ**
✅ Phases 1 + 2 + 3  
= Système complet autonome avec IA

---

### **ÉQUIPE RECOMMANDÉE**

**Configuration optimale : 2-3 développeurs**

**Développeur 1 (Backend/BDD) :**
- Schémas base de données
- Services métier
- APIs & intégrations

**Développeur 2 (Frontend/UX) :**
- Interfaces utilisateur
- Dashboards & rapports
- Workflows visuels

**Développeur 3 (DevOps/Qualité) :**
- Tests & validation
- Déploiement & monitoring
- Performance & sécurité

**= Livraison MVP complet en 7-10 mois**

---

## ✅ CONCLUSION

### **MVP Yaro FleetOS - Vision Complète**

**Fondations actuelles (76%) :**
- ✅ Gestion flotte complète
- ✅ Maintenance préventive
- ✅ Contrôle carburant
- ✅ Base RH/Personnel

**Développements MVP (19,5 mois) :**
- ✅ Fournisseurs & Achats finalisés
- ✅ Facturation & Clients complets
- ✅ Gestion Opérations optimisée
- ✅ Trésorerie & Pilotage financier
- ✅ Workflows automatisés
- ✅ Analytics & BI avancés

**Résultat Final :**
**Système de gestion de flotte 100% autonome, digitalisé, automatisé avec ROI démontré et pilotage stratégique complet.**

---

## 📋 PROCHAINES ACTIONS - PHASE 1.1.2

### **À COMPLÉTER : Automatisations Commandes (15% restant)**

#### **1. Cron Job Regroupement Hebdomadaire**
- Analyser demandes approuvées tous les lundis 9h
- Générer suggestions de regroupement
- Notifier admin/workshop_manager

#### **2. Notifications Fournisseurs par Email**
- Email automatique lors envoi commande
- Confirmation de réception requise
- Suivi de livraison intégré

#### **3. Alertes Retards Livraison**
- Vérification quotidienne dates livraison
- Notification si date dépassée
- Relance fournisseur automatique

**Durée estimée :** 1 semaine  
**Impact ROI :** Automatisation complète workflow achats

---

*Document généré le 6 octobre 2025 - Mis à jour le 8 octobre 2025 - Yaro FleetOS Team*
