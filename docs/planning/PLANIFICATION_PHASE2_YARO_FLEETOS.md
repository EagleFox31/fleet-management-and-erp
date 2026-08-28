# 📋 PLANIFICATION PHASE 2 - YARO FLEETOS
## Développement Services & Interfaces par Rôle

**Date de mise à jour :** 29 septembre 2025  
**Phase précédente :** Phase 1 - Enrichissement schémas ✅ TERMINÉE  
**Phase actuelle :** Phase 2 - Services métier & Interfaces utilisateur  

---

## 🎯 RÉSUMÉ PHASE 1 COMPLÉTÉE

### **✅ Données importées avec succès**
1. **Fournisseurs** : 12 importés (CFAO MOBILITY, ONE WORLD BUSINESS, BERNABE, etc.)
2. **Véhicules** : 27 importés avec enrichissement
   - Champs ajoutés : `numeroVecteur`, `currentKilometers`, `locationCode`, `maintenancePosition`
3. **Chauffeurs** : 27 importés avec noms complets
   - Schéma modifié : ajout `firstName`, `lastName`
4. **Factures fournisseurs** : 96 importées
   - TVA 19.25% automatique, calculs TTC/solde
5. **Documentation véhicules** : 22 véhicules
   - Dates : carte grise, assurance, visite technique
6. **Inventaire pièces** : 58 pièces (valeur 94,4M FCFA)
   - Catégories : pneus, batteries, huiles, pièces moteur
   - Champs : `category`, `realStock`, `reorderAlert`
7. **Consommation carburant** : 24 enregistrements (août 2025)
   - Système carte rechargeable : crédit/débit
   - Solde temps réel : 14,1M FCFA
   - Schéma modifié : `vehicleId` nullable, ajout `fuelType`, `stationName`

### **📋 Schémas enrichis Phase 1**
```typescript
// Tables mises à jour
vehicles : numeroVecteur, currentKilometers, locationCode, maintenancePosition
drivers : firstName, lastName (ajoutés)
parts : category, realStock, reorderAlert
fuelRecords : fuelType, stationName, creditAmount, debitAmount, balance, fuelBalance
supplierInvoices : family, quantity, vatAmount, totalTTC, balance
```

### **⏰ Module en attente**
- **Time Tracking (Pointage)** : Table créée, données à importer ultérieurement
  - Codes : JT, M, Mi, C, A, R, Re
  - Stats mensuelles préparées

---

## 🏗️ OBJECTIFS PHASE 2

### **Vision globale**
Développer les **services métier** et les **interfaces utilisateur** pour les 8 rôles opérationnels, en reproduisant fidèlement les **workflows Excel** existants avec automatisation et calculs temps réel.

### **Résultats attendus**
- ✅ Services métier complets avec calculs automatiques Excel
- ✅ Dashboards spécialisés par rôle utilisateur
- ✅ APIs enrichies pour chaque module
- ✅ Interfaces correspondance parfaite workflows Excel
- ✅ Alertes et notifications temps réel
- ✅ Exploitation complète des 94,4M FCFA de pièces importées
- ✅ Gestion carte carburant avec solde 14,1M FCFA

---

## 🛠️ SERVICES MÉTIER À DÉVELOPPER

### **1. Service TVA & Facturation** 🔴 PRIORITÉ 1

**Fichier :** `server/services/vat-billing-service.ts`

**Fonctionnalités :**
```typescript
class VATBillingService {
  // Calcul TVA 19.25% automatique (déjà dans supplierInvoices)
  calculateVAT(amountHT: number): {
    vatAmount: number;
    totalTTC: number;
  }
  
  // Utiliser les 96 factures fournisseurs importées
  getSupplierInvoices(supplierId?: number): Promise<SupplierInvoice[]>
  
  // Synthèse par fournisseur (12 fournisseurs réels)
  getSuppliersSummary(): Promise<{
    supplierName: string;
    totalInvoicesHT: number;
    totalVAT: number;
    totalPayments: number;
    totalBalance: number;
  }[]>
  
  // Gestion paiements et soldes
  recordPayment(invoiceId: number, amount: number): Promise<void>
  
  // Statistiques par famille (PIECES DETACHEES, ASSURANCE, etc.)
  getInvoicesByFamily(): Promise<Record<string, number>>
}
```

**Données réelles disponibles :**
- 96 factures fournisseurs
- 12 fournisseurs (CFAO, ONE WORLD, BERNABE, TOTAL, ACTIVA, etc.)
- TVA 19.25% déjà calculée
- Familles : PIECES DETACHEES, ASSURANCE, CARBURANT, INTERNET

---

### **2. Service Stock & Alertes** 🔴 PRIORITÉ 1

**Fichier :** `server/services/stock-alerts-service.ts`

**Fonctionnalités :**
```typescript
class StockAlertsService {
  // Exploiter les 58 pièces importées (94,4M FCFA)
  getInventoryValue(): Promise<{
    totalValue: number;          // 94 366 959 FCFA
    totalParts: number;          // 58
    byCategory: Record<string, {
      count: number;
      value: number;
    }>;
  }>
  
  // Utiliser realStock et reorderAlert déjà calculés
  getReorderAlerts(): Promise<{
    parts: Part[];               // 38 pièces en alerte
    totalShortage: number;
    estimatedCost: number;
  }>
  
  // Mouvements stock (ENTRÉE/SORTIE)
  recordStockMovement(data: {
    partId: number;
    type: 'ENTRÉE' | 'SORTIE';
    quantity: number;
    workOrderId?: number;        // Si lié à une intervention
    responsiblePerson: string;
  }): Promise<void>
  
  // Recalculer realStock automatique
  updateRealStock(partId: number): Promise<number>
  
  // Pièces les plus utilisées (pneus 385/65R22,5, batteries VISCA, etc.)
  getMostUsedParts(limit: number): Promise<Part[]>
}
```

**Données réelles disponibles :**
- 58 pièces détachées
- Valeur totale : 94 366 959 FCFA
- 38 alertes stock bas actives
- Catégories : pneus, batteries, huiles, filtres, pièces moteur
- Prix réels : 11 000 à 3 600 000 FCFA/unité

---

### **3. Service Carburant Carte Rechargeable** 🔴 PRIORITÉ 1

**Fichier :** `server/services/fuel-card-service.ts`

**Fonctionnalités :**
```typescript
class FuelCardService {
  // Exploiter les 24 enregistrements août 2025 importés
  getCurrentBalance(): Promise<{
    balance: number;              // 14 117 712 FCFA
    fuelBalance: number;          // Litres disponibles
    lastCredit: FuelRecord;       // 8 259 352 FCFA
    lastDebit: FuelRecord;
    totalCredits: number;         // 24 778 056 FCFA
    totalDebits: number;          // 10 660 344 FCFA
  }>
  
  // Recharge carte (comme importé)
  rechargeCard(data: {
    amount: number;
    quantity: number;             // Litres achetés
    date: Date;
    paymentMode: string;
    orderNumber?: string;
  }): Promise<FuelRecord>
  
  // Consommation véhicule (27 véhicules actifs)
  recordConsumption(data: {
    vehicleId: number;            // 27 véhicules disponibles
    quantity: number;             // Litres
    unitPrice: number;            // Défaut 828 FCFA/L
    stationName: string;          // MAERSK, CNPCC, AGL, etc.
    destination: string;
    clientName?: string;
  }): Promise<FuelRecord>
  
  // Historique multi-années (year, month)
  getFuelHistory(filters: {
    year?: number;
    month?: number;
    vehicleId?: number;
  }): Promise<FuelRecord[]>
  
  // Consommation par véhicule/client
  getConsumptionStats(vehicleId: number): Promise<{
    totalLiters: number;
    totalCost: number;
    averagePricePerLiter: number;
    mainStations: string[];
    mainDestinations: string[];
  }>
  
  // Détection anomalies
  detectAnomalies(vehicleId: number): Promise<{
    hasAnomaly: boolean;
    averageConsumption: number;
    currentConsumption: number;
    deviation: number;
  }[]>
}
```

**Données réelles disponibles :**
- 24 enregistrements août 2025
- 3 recharges : 24 778 056 FCFA
- 21 consommations : 10 660 344 FCFA
- Solde actuel : 14 117 712 FCFA
- Prix moyen : 828 FCFA/L
- Stations : MAERSK, CNPCC, AGL, SODECOTON
- Destinations : NDJAMENA, DLA-NDERE, TOUBORO

---

### **4. Service Véhicules & Documentation** 🟡 PRIORITÉ 2

**Fichier :** `server/services/vehicle-documentation-service.ts`

**Fonctionnalités :**
```typescript
class VehicleDocumentationService {
  // Exploiter les 27 véhicules et 22 avec documentation
  getExpiringDocuments(daysBeforeExpiry: number = 30): Promise<{
    carteGrise: Vehicle[];
    assurance: Vehicle[];
    visiteTechnique: Vehicle[];
  }>
  
  // Alertes documents expirés
  getExpiredDocuments(): Promise<Vehicle[]>
  
  // Mise à jour kilométrage (currentKilometers)
  updateMileage(vehicleId: number, kilometers: number): Promise<void>
  
  // Suivi position maintenance
  updateMaintenancePosition(vehicleId: number, position: string): Promise<void>
  
  // Historique statuts (operational, maintenance, out_of_service)
  getStatusHistory(vehicleId: number): Promise<StatusHistory[]>
}
```

**Données réelles disponibles :**
- 27 véhicules importés
- 22 avec documentation complète
- Dates expiration : carte grise, assurance, visite technique
- Champs enrichis : numeroVecteur, currentKilometers, locationCode

---

### **5. Service CPC & Formations** 🟡 PRIORITÉ 2

**Fichier :** `server/services/cpc-training-service.ts`

**Fonctionnalités :**
```typescript
class CPCTrainingService {
  // Utiliser les 27 chauffeurs importés
  getAllDriversStatus(): Promise<{
    firstName: string;
    lastName: string;
    cpcStatus: 'FORMÉ' | 'À FORMER' | 'NON FORMÉ';
    cpcDate: Date;
    expiryDate: Date;
    daysRemaining: number;
  }[]>
  
  // Calcul statut CPC automatique
  calculateCPCStatus(cpcDate: Date): 'FORMÉ' | 'À FORMER' | 'NON FORMÉ'
  
  // Alertes formations (59 jours avant expiration)
  getExpiringCPCAlerts(): Promise<Driver[]>
  
  // Mise à jour formation
  updateCPCCertification(driverId: number, newDate: Date): Promise<void>
  
  // Pointage journalier (quand données disponibles)
  recordDailyAttendance(data: {
    userId: number;
    date: Date;
    status: 'JT' | 'M' | 'Mi' | 'C' | 'A' | 'R' | 'Re';
  }): Promise<TimeTracking>
  
  // Stats mensuelles (table monthlyTimeStats)
  getMonthlyStats(userId: number, year: number, month: number): Promise<{
    workedDays: number;
    sickDays: number;
    missionDays: number;
    leaveDays: number;
    absentDays: number;
    restDays: number;
    lateDays: number;
  }>
}
```

**Données réelles disponibles :**
- 27 chauffeurs avec firstName/lastName
- Table timeTracking créée (codes JT/M/Mi/C/A/R/Re)
- Table monthlyTimeStats créée
- Formule CPC : 731 jours validité, alerte 59 jours avant

---

### **6. Service Opérations & Facturation Clients** 🟢 PRIORITÉ 3

**Fichier :** `server/services/operations-billing-service.ts`

**Fonctionnalités :**
```typescript
class OperationsBillingService {
  // Créer opération basée sur consommation carburant réelle
  createOperation(data: {
    date: Date;
    vehicleId: number;           // 27 véhicules disponibles
    fuelRecordId: number;        // Lié aux 24 enregistrements
    departure: string;
    destination: string;         // NDJAMENA, DLA-NDERE, etc.
    clientName: string;          // MAERSK, CNPCC, AGL
    fuelConsumption: number;     // Depuis fuelRecords
    roadExpenses: number;        // FDR
  }): Promise<Operation>
  
  // Calcul coûts depuis données réelles
  calculateOperationCosts(operationId: number): Promise<{
    fuelCost: number;            // Depuis fuelRecords.debitAmount
    roadExpenses: number;
    totalCost: number;
    vehicleCost: number;         // Amortissement si purchasePrice disponible
  }>
  
  // Facturation client
  createClientInvoice(data: {
    operationId: number;
    amount: number;
    dueDate: Date;
  }): Promise<ClientInvoice>
  
  // Suivi par client (MAERSK présent dans fuelRecords)
  getClientOperations(clientName: string): Promise<{
    operations: Operation[];
    totalFuelConsumed: number;
    totalCost: number;
    totalRevenue: number;
    margin: number;
  }>
}
```

**Données réelles disponibles :**
- 24 enregistrements carburant août 2025
- Clients identifiés : MAERSK, CNPCC, AGL, SODECOTON
- Destinations : NDJAMENA, DLA-NDERE, TOUBORO
- Coûts réels : 207 000 - 622 500 FCFA par mission
- 27 véhicules opérationnels

---

## 🖥️ INTERFACES UTILISATEUR PAR RÔLE

### **1. Dashboard Secrétaire** 🔴 PRIORITÉ 1

**Route :** `/secretary/dashboard`

**Composants :**
```
SecretaryDashboard/
├── DocumentExpiryPanel.tsx          // 22 véhicules avec dates
├── VehicleMileageUpdate.tsx         // currentKilometers
├── ClientInvoicesPanel.tsx          // Facturation clients
├── DailyOperationsForm.tsx          // Saisie opérations
└── SupplierInvoicesView.tsx         // 96 factures fournisseurs
```

**Données à exploiter :**
- 22 véhicules avec documentation
- Alertes expiration automatiques
- 96 factures fournisseurs à suivre

---

### **2. Dashboard Logisticien** 🔴 PRIORITÉ 1

**Route :** `/logistics/dashboard`

**Composants :**
```
LogisticsDashboard/
├── FuelCardBalance.tsx              // Solde 14,1M FCFA
├── VehicleAvailability.tsx          // 27 véhicules
├── MissionPlanner.tsx               // Destinations réelles
├── FuelConsumptionTracker.tsx       // 24 enregistrements
└── ClientOperationsPanel.tsx        // MAERSK, CNPCC, etc.
```

**Données à exploiter :**
- Solde carte : 14 117 712 FCFA
- 27 véhicules disponibles
- Destinations : NDJAMENA, DLA-NDERE, TOUBORO
- Clients : MAERSK, CNPCC, AGL, SODECOTON

---

### **3. Dashboard Magasinier** 🔴 PRIORITÉ 1

**Route :** `/warehouse/dashboard`

**Composants :**
```
WarehouseDashboard/
├── InventoryValuePanel.tsx          // 94,4M FCFA
├── ReorderAlertsPanel.tsx           // 38 alertes actives
├── RealTimeStockPanel.tsx           // 58 pièces
├── StockMovementsForm.tsx           // Entrées/sorties
└── TopPartsChart.tsx                // Pneus, batteries, etc.
```

**Données à exploiter :**
- 58 pièces : 94 366 959 FCFA
- 38 alertes CDE actives
- Catégories : PIECES DETACHEES
- Prix réels : 11 000 - 3 600 000 FCFA

---

### **4. Dashboard Technicien (Enrichissement)** 🟡 PRIORITÉ 2

**Route :** `/technician/dashboard` (existant)

**Composants à ajouter :**
```
TechnicianDashboard/
├── PartsAvailability.tsx            // 58 pièces disponibles
├── RealStockChecker.tsx             // realStock temps réel
├── WorkOrderPartsUsage.tsx          // Consommation par ordre
└── MaintenanceHistory.tsx           // Historique complet
```

**Données à exploiter :**
- 58 pièces avec stock réel
- Alertes si pièce manquante
- Historique work_orders existant

---

### **5. Dashboard Chef d'atelier (Enrichissement)** 🟡 PRIORITÉ 2

**Route :** `/workshop-manager/dashboard` (existant)

**Composants à ajouter :**
```
WorkshopManagerDashboard/
├── TeamDriversPanel.tsx             // 27 chauffeurs
├── CPCStatusOverview.tsx            // Statuts formations
├── VehicleMaintenanceStatus.tsx     // 27 véhicules
└── PartsConsumptionAnalysis.tsx     // Top pièces utilisées
```

**Données à exploiter :**
- 27 chauffeurs avec CPC
- 27 véhicules avec statuts
- Consommation pièces par technicien

---

## 📡 APIs À DÉVELOPPER

### **APIs Factures & TVA**
```typescript
GET    /api/suppliers                         // 12 fournisseurs
GET    /api/suppliers/:id/invoices            // 96 factures
GET    /api/suppliers/summary                 // Synthèse réelle
POST   /api/suppliers/invoices/:id/payment    // Paiement
GET    /api/invoices/by-family                // PIECES, ASSURANCE, etc.
```

### **APIs Stock & Pièces**
```typescript
GET    /api/parts                             // 58 pièces
GET    /api/parts/inventory-value             // 94,4M FCFA
GET    /api/parts/reorder-alerts              // 38 alertes
POST   /api/parts/:id/movements               // Entrées/sorties
GET    /api/parts/most-used                   // Top pièces
```

### **APIs Carburant**
```typescript
GET    /api/fuel-card/balance                 // 14,1M FCFA
GET    /api/fuel-card/history                 // 24 enregistrements
POST   /api/fuel-card/recharge                // Nouvelle recharge
POST   /api/fuel-card/consumption             // Consommation
GET    /api/fuel/by-vehicle/:id               // Par véhicule
GET    /api/fuel/by-client/:name              // MAERSK, CNPCC, etc.
```

### **APIs Véhicules & Documentation**
```typescript
GET    /api/vehicles                          // 27 véhicules
GET    /api/vehicles/expiring-docs            // 22 avec dates
PUT    /api/vehicles/:id/mileage              // Update currentKilometers
GET    /api/vehicles/:id/fuel-consumption     // Consommation réelle
```

### **APIs Chauffeurs & CPC**
```typescript
GET    /api/drivers                           // 27 chauffeurs
GET    /api/drivers/cpc-status                // Statuts tous
GET    /api/drivers/expiring-cpc              // Alertes formations
POST   /api/drivers/:id/update-cpc            // Mise à jour
POST   /api/time-tracking                     // Pointage (futur)
```

---

## 📅 PLANNING PHASE 2 RÉVISÉ

### **Sprint 1 (Semaines 1-2) : Services fondamentaux**
**Objectif :** Exploiter les données importées

- 🔴 Service Stock & Alertes (58 pièces, 94,4M FCFA) - 3j
- 🔴 Service Carburant Carte (24 enregistrements, 14,1M FCFA) - 3j
- 🔴 Service Factures TVA (96 factures, 12 fournisseurs) - 3j
- ✅ Tests unitaires services - 2j

### **Sprint 2 (Semaines 3-4) : Interfaces opérationnelles**
**Objectif :** Dashboards avec données réelles

- 🔴 Dashboard Magasinier (58 pièces, 38 alertes) - 3j
- 🔴 Dashboard Logisticien (carte 14,1M FCFA, 27 véhicules) - 3j
- 🔴 Dashboard Secrétaire (22 véhicules documentation) - 3j
- ✅ Tests e2e interfaces - 2j

### **Sprint 3 (Semaines 5-6) : Services avancés**
**Objectif :** Automatisation et calculs

- 🟡 Service Véhicules & Documentation (27 véhicules) - 3j
- 🟡 Service CPC & Formations (27 chauffeurs) - 3j
- 🟡 Enrichissement dashboards existants - 3j
- ✅ Intégration continue - 2j

### **Sprint 4 (Semaines 7-8) : Modules métier**
**Objectif :** Opérations et facturation

- 🟢 Service Opérations & Facturation clients - 4j
- 🟢 Interfaces MAERSK/CNPCC spécifiques - 2j
- 🟢 Exports Excel et rapports - 3j
- ✅ Tests complets et corrections - 3j

---

## 🎯 CRITÈRES DE SUCCÈS PHASE 2

### **Exploitation données importées**
- ✅ 58 pièces détachées exploitées (94,4M FCFA)
- ✅ 96 factures fournisseurs intégrées
- ✅ 27 véhicules avec documentation suivie
- ✅ 27 chauffeurs avec CPC géré
- ✅ Système carte carburant opérationnel (14,1M FCFA)
- ✅ 38 alertes CDE automatiques

### **Services métier**
- ✅ 6 services complets avec tests unitaires
- ✅ Calculs automatiques Excel reproduits
- ✅ APIs RESTful documentées
- ✅ Performance < 500ms (95% requêtes)

### **Interfaces utilisateur**
- ✅ 5 dashboards par rôle fonctionnels
- ✅ Données réelles affichées partout
- ✅ Alertes temps réel opérationnelles
- ✅ Export Excel depuis toutes les vues

### **Gains utilisateurs**
- ✅ Magasinier : Valeur stock visible (94,4M FCFA)
- ✅ Logisticien : Solde carte temps réel (14,1M FCFA)
- ✅ Secrétaire : Alertes expiration documents (22 véhicules)
- ✅ Technicien : Disponibilité pièces instantanée (58 pièces)
- ✅ Chef atelier : Statuts CPC chauffeurs (27 chauffeurs)

---

## ✅ CONCLUSION PHASE 2

La **Phase 1** a importé avec succès **7 modules de données critiques** :
- 12 fournisseurs, 96 factures
- 27 véhicules, 27 chauffeurs
- 58 pièces (94,4M FCFA)
- 24 enregistrements carburant (solde 14,1M FCFA)
- 22 véhicules documentés

La **Phase 2** va maintenant **exploiter ces données réelles** pour créer des services métier et interfaces opérationnelles reproduisant les workflows Excel avec automatisation complète.

**Durée estimée :** 8 semaines (4 sprints)  
**Équipe requise :** 2-3 développeurs full-stack  
**Prêt à démarrer :** ✅ OUI (données réelles disponibles)

---

*Document mis à jour - 29 septembre 2025*  
*Base : Phase 1 terminée (7 imports réussis) + Schémas enrichis + Données réelles*
