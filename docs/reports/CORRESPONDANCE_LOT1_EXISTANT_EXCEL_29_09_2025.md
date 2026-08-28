# 📋 CORRESPONDANCE LOT 1 YARO FLEETOS - EXISTANT EXCEL
## Analyse Exhaustive des Fichiers Importants et Orientation Développement
### Date : 29 septembre 2025

---

## 🎯 **OBJECTIF DU DOCUMENT**

Ce document établit la correspondance précise entre le **LOT 1 de Yaro FleetOS** (5 modules fondamentaux) et l'**existant Excel complexe** analysé dans les fichiers fournis. Il identifie les fichiers critiques, les structures de données à reprendre, les règles de gestion à implémenter et l'orientation de développement pour assurer une transition cohérente.

### **LOT 1 Yaro FleetOS :**
1. **Flotte & Documents** (90% implémenté)
2. **Maintenance & Stock** (95% implémenté) 
3. **Personnel/Habilitations** (80% implémenté)
4. **Gestion Carburant** (85% implémenté)
5. **Fournisseurs & Achats** (30% implémenté)

---

## 📁 **FICHIERS CRITIQUES PAR MODULE LOT 1**

### 🚗 **MODULE 1: FLOTTE & DOCUMENTS**

#### **Fichiers Excel sources critiques :**

**1. SUIVI DES CAMION TAY.xlsx**
- **Feuilles importantes** : "Anciennes Donnees", "SUIVI 2025", "Feuil1"
- **Correspondance Yaro** : Table `vehicles` avec historique maintenance
- **Structure critique à reprendre** :
```sql
-- Correspondance Excel → Yaro
N° Camions (Excel) → registrationNumber (Yaro)
Kilométrage actuel → mileage (Yaro)
Prochain Kilométrage → nextMaintenanceMileage (Yaro)
Position/Lieu → location fields (à ajouter)
```

**2. Analyse du fichier « EXEMPLAIRE SUIVI MAINTENANCE.xlsm »**
- **Feuille "stock"** : Correspondance avec système documents véhicules
- **Table T_LISTES** : Référentiel pièces à intégrer
- **Validation** : Integration avec `vehicleDocuments` existant

#### **Données critiques à migrer :**

**Véhicules existants (structure Excel) :**
```excel
LTTR 263 AV, LTTR 181 AU, LTTR 211 AU, ADTR 775 AC
LTSR 793 AU, LTTR 411 AX, LTTR 409 AX, LTTR 766 AR, LTTR 182 AV
CETR 955 AE (exemples identifiés)
```

**Correspondance avec schema Yaro :**
```typescript
// Structure actuelle Yaro à enrichir
vehicles: {
  id: serial("id").primaryKey(),
  registrationNumber: text("registration_number").notNull().unique(),
  // À ajouter depuis Excel:
  numeroVecteur: text("numero_vecteur"), // N° Camions Excel
  currentKilometers: integer("current_kilometers"), // Kilométrage actuel
  locationCode: text("location_code"), // Lieu Excel
  maintenancePosition: text("maintenance_position"), // Position Excel
}
```

#### **Règles de gestion Excel à implémenter :**

**1. Calcul automatique maintenance :**
```excel
Reste km = Prochain Kilométrage - Kilométrage actuel
Total Km Parcouru = Kilométrage précédent - Kilométrage actuel
```

**2. Planification préventive par catégorie :**
- Plaquettes, Garniture remorque, Pneumatique
- Huile de vidange, Radiateur, Batterie, Roulement
- Vidange boîte-pont-satellite, Filtres (air, répétiteur)

#### **Actions développement prioritaires :**

1. **Migration données Excel → Yaro** : Script import véhicules existants
2. **Enrichissement schema** : Champs numeroVecteur, currentKilometers
3. **Interface correspondance** : Écrans de saisie kilométrage
4. **Calculs automatiques** : Reste km, prochaine maintenance

---

### 🔧 **MODULE 2: MAINTENANCE & STOCK**

#### **Fichiers Excel sources critiques :**

**1. EXEMPLAIRE SUIVI MAINTENANCE.xlsm**
- **Feuille "MAINTENANCE"** : Correspondance avec `workOrders` Yaro
- **Feuille "PNEUMATIQUE"** : Correspondance avec `tires` système Yaro
- **Feuille "VIDANGE"** : Correspondance avec maintenance préventive

**2. FEUILLE EXCEL EXEMPLAIRE SUIVI MAINTENANCE_1759164771749.docx**
- **Feuille "STOCK"** : Correspondance précise avec `parts` Yaro
- **Table "T_LISTES"** : Référentiel central à migrer

#### **Structure stock Excel → Yaro :**

**Correspondance colonnes critiques :**
```sql
-- Excel STOCK → Yaro parts
REFERENCE (Excel) → reference (Yaro) ✅ Déjà implémenté
LIBELLE (Excel) → name (Yaro) ✅ Déjà implémenté
QTE (Excel) → quantity (Yaro) ✅ Déjà implémenté
STOCK_DE_SECURITE (Excel) → minQuantity (Yaro) ✅ Déjà implémenté
PRIX_TU (Excel) → unitPrice (Yaro) ✅ Déjà implémenté
FOURNISSEUR (Excel) → supplier (Yaro) ✅ Déjà implémenté

-- À ajouter dans Yaro :
GROUPE_ARTICLES (Excel) → category (nouveau champ)
LIEU (Excel) → location (nouveau champ)
MAGASIN_MECANICIEN (Excel) → responsiblePerson (nouveau champ)
N_BL_BS (Excel) → deliveryReceiptNumber (nouveau champ)
```

**Formules Excel critiques à reproduire :**
```excel
STOCK_APRES_MOUVEMENTS = RECHERCHEV + SOMME.SI.ENS(ENTREE) - SOMME.SI.ENS(SORTIE)
STOCK_REEL = SOMME.SI.ENS([QTE];[TRANSACTION];"ENTRÉE") - SOMME.SI.ENS([QTE];[TRANSACTION];"SORTIE")
SITUATION = SI(STOCK_REEL <= STOCK_DE_SECURITE;"CDE";"")
```

#### **Données pneumatiques Excel → Yaro :**

**Structure PNEUMATIQUE Excel :**
```excel
Date_entree, Fournisseur, N_fac_bl, Qte_entree, Designation, Reference
Date_sortie, Qte_sortie, Immatriculation, Position, Km_compteur
Km_parcourue = Km_actuel - Km_compteur, Observation
```

**Correspondance TiresService Yaro (déjà implémenté) :**
```typescript
// À enrichir avec données Excel
tires: {
  // Champs existants ✅
  id, size, brand, type, quantity, unitCost, condition, location
  // À ajouter depuis Excel :
  entryDate: date("entry_date"), // Date_entree
  supplierInvoice: text("supplier_invoice"), // N_fac_bl
  vehiclePosition: text("vehicle_position"), // Position
  installationKm: integer("installation_km"), // Km_compteur
  currentKm: integer("current_km"), // Km_actuel
  kmTraveled: integer("km_traveled").generatedAs(), // Calculé
}
```

#### **Maintenance Excel → Yaro :**

**Correspondance MAINTENANCE Excel :**
```excel
Date, Libelle, Camion, Client_Fournisseur, Sortie, Depanne_par, Observation
```

**Avec workOrders Yaro (déjà implémenté) :**
```typescript
workOrders: {
  // Correspondance directe ✅
  startDate ← Date, title/description ← Libelle
  vehicleId ← Camion, cost ← Sortie
  // À enrichir :
  supplierName: text("supplier_name"), // Client_Fournisseur
  repairedBy: text("repaired_by"), // Depanne_par
  observations: text("observations"), // Observation
}
```

#### **Actions développement prioritaires :**

1. **Migration données** : Import T_LISTES → table parts Yaro
2. **Enrichissement schema** : Champs category, location, responsiblePerson
3. **Formules automatiques** : Calculs stock temps réel, alertes CDE
4. **Dashboard stock** : Reproduction tableau de bord Excel TBD

---

### 👥 **MODULE 3: PERSONNEL/HABILITATIONS**

#### **Fichiers Excel sources critiques :**

**1. CPC ET HABILITATION.xlsx**
- **Feuille "CPC"** : Correspondance avec `users` et système habilitations
- **Calculs automatiques** : Statut formation CPC, validité permis

**2. POINTAGE ETS YARORO_1759164771754.docx**
- **Pointage mensuel** : Système de présence à intégrer
- **Codes** : JT, M, Mi, C, A, R, Re (Journée Travaillée, Maladie, Mission, Congé, Absent, Repos, Retard)

#### **Structure CPC Excel → Yaro :**

**Données chauffeurs critiques :**
```excel
N°, NOM DU CHAUFFEUR, DATE NAISSANCE, VALIDITÉ CNI
N° PERMIS, VALIDITÉ PERMIS, FORMATION GEO, DATE FORMATION CPC
STATUT FORMATION CPC = Formule complexe (731 jours, FORMÉ/À FORMER/NON FORMÉ)
```

**Correspondance users Yaro (à enrichir) :**
```typescript
// Schema actuel Yaro
users: {
  id, username, password, email, name, role, createdAt, deletedAt
}

// À ajouter pour correspondance Excel :
drivers: {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  employeeNumber: text("employee_number"), // N° Excel
  birthDate: date("birth_date"), // DATE NAISSANCE
  cniNumber: text("cni_number"), // CNI
  cniExpiry: date("cni_expiry"), // VALIDITÉ CNI
  licenseNumber: text("license_number"), // N° PERMIS
  licenseExpiry: date("license_expiry"), // VALIDITÉ PERMIS
  geoTrainingDate: date("geo_training_date"), // FORMATION GEO
  cpcTrainingDate: date("cpc_training_date"), // DATE FORMATION CPC
  cpcStatus: text("cpc_status"), // STATUT calculé
}
```

**Formule CPC Excel à reproduire :**
```excel
=SI(I4="";"";SI(I4+731>AUJOURDHUI();SI(I4+731>(AUJOURDHUI()+59);"FORME";"A FORMER");"NON FORME"))
```

**En TypeScript/SQL :**
```typescript
const calculateCPCStatus = (cpcDate: Date): string => {
  if (!cpcDate) return "";
  const expiryDate = new Date(cpcDate.getTime() + 731 * 24 * 60 * 60 * 1000);
  const warningDate = new Date(Date.now() + 59 * 24 * 60 * 60 * 1000);
  
  if (expiryDate > Date.now()) {
    return expiryDate > warningDate ? "FORMÉ" : "À FORMER";
  }
  return "NON FORMÉ";
};
```

#### **Système pointage Excel → Yaro :**

**Structure POINTAGE Excel :**
```excel
N°, NOMS EMPLOYES, JOURNEE TRAVAILLEE, CONGE, ABSENCE, REPOS, RETARD, MALADIE, MISSION
+ Colonnes par jour du mois avec codes : JT, M, Mi, C, A, R, Re
```

**Schema Yaro à créer :**
```typescript
timeTracking: {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  date: date("date").notNull(),
  status: text("status").notNull(), // JT, M, Mi, C, A, R, Re
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  notes: text("notes"),
}

monthlyTimeStats: {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  workedDays: integer("worked_days").default(0), // NB.SI(JT)
  sickDays: integer("sick_days").default(0), // NB.SI(M)
  missionDays: integer("mission_days").default(0), // NB.SI(Mi)
  leaveDays: integer("leave_days").default(0), // NB.SI(C)
  absentDays: integer("absent_days").default(0), // NB.SI(A)
  restDays: integer("rest_days").default(0), // NB.SI(R)
  lateDays: integer("late_days").default(0), // NB.SI(Re)
}
```

#### **Actions développement prioritaires :**

1. **Migration CPC** : Import données chauffeurs existants
2. **Schema enrichissement** : Tables drivers, timeTracking, monthlyTimeStats
3. **Calculs automatiques** : Statut CPC, statistiques pointage
4. **Interface pointage** : Écran mensuel avec codes Excel

---

### ⛽ **MODULE 4: GESTION CARBURANT**

#### **Système de carte carburant rechargeable :**

**Workflow opérationnel :**
```
Étape 1 : Rechargement carte carburant (crédit)
Étape 2 : Mission camion → Utilisation carte à station partenaire
Étape 3 : Consommation enregistrée (débit)
Étape 4 : Mise à jour automatique solde carburant
```

**Correspondance Yaro :**
```typescript
// fuelRecords enrichi pour gérer le système carte
fuelRecords: {
  // Rechargement carte
  creditAmount: numeric("credit_amount"), // Montant rechargé
  // Consommation mission
  debitAmount: numeric("debit_amount"), // Consommation station
  // Solde temps réel
  balance: numeric("balance"), // Solde restant carte
  fuelBalance: numeric("fuel_balance"), // Équivalent litres
  // Station et carte
  supplierType: text("supplier_type"), // Station partenaire
  paymentMode: text("payment_mode"), // "Carte rechargeable"
}
```

#### **Fichiers Excel sources critiques :**

**1. SYSTÈME DE GESTION TRANSPORT_feuille excel_1759164771754.docx**
- **Feuille CONSOMMATION** : Correspondance avec `fuelRecords` Yaro
- **Règles complexes** : Approvisionnement, crédit/débit, solde carburant
- **Carte rechargeable** : Système crédit/débit automatique

**2. BESOIN LOGISTIQUE (Analyse Complète des Fichiers Logistiques)**
- **Calculs quotidiens** : Consommation × 828 FCFA/L
- **FDR (Frais de Route)** : Variables par destination
- **Extras** : Rations, ligatures, GPS

#### **Structure CONSOMMATION Excel → Yaro :**

**Colonnes Excel critiques :**
```excel
N°, Mois, Date, Fournisseur/approvisionnement/immatriculation
Credit_comptant/BON DE COMMANDE N°/client
Chèque N°/Destination, Litres, Tarif, Credit, Debit, Solde, Solde Gasoil
```

**Correspondance fuelRecords Yaro (enrichissement nécessaire) :**
```typescript
// Schema actuel Yaro
fuelRecords: {
  id, vehicleId, date, quantity, cost, mileage, fullTank, notes, createdBy, createdAt
}

// À enrichir pour correspondance Excel complète :
fuelRecords: {
  // Champs existants ✅
  id, vehicleId, date, quantity, cost, mileage, fullTank, notes, createdBy, createdAt
  // Nouveaux champs depuis Excel :
  recordNumber: text("record_number"), // N° Excel
  month: integer("month"), // Mois Excel
  supplierType: text("supplier_type"), // Fournisseur/approvisionnement
  paymentMode: text("payment_mode"), // Credit_comptant
  orderNumber: text("order_number"), // BON DE COMMANDE N°
  clientName: text("client_name"), // client Excel
  checkNumber: text("check_number"), // Chèque N°
  destination: text("destination"), // Destination Excel
  unitPrice: numeric("unit_price"), // Tarif Excel
  creditAmount: numeric("credit_amount"), // Credit Excel
  debitAmount: numeric("debit_amount"), // Debit Excel
  balance: numeric("balance"), // Solde Excel
  fuelBalance: numeric("fuel_balance"), // Solde Gasoil
}
```

**Règles de calcul Excel à reproduire :**
```excel
Debit = Litres × Tarif
Solde = Solde_précédent + Credit - Debit
Solde Gasoil = Solde / Tarif
```

#### **BESOIN LOGISTIQUE Excel → Yaro :**

**Structure journalière Excel :**
```excel
DATE, CAMIONS, DEPART, DESTINATION, CLIENT, CONSOMMATION, MONTANT CONSO, FDR, TOTAL
Règles : MONTANT CONSO = CONSOMMATION × 828 FCFA/L
TOTAL = MONTANT CONSO + FDR
```

**Schema Yaro à créer :**
```typescript
dailyLogisticsNeeds: {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  departure: text("departure"),
  destination: text("destination"),
  clientName: text("client_name"),
  fuelConsumption: numeric("fuel_consumption"), // Litres
  fuelCost: numeric("fuel_cost"), // MONTANT CONSO
  roadExpenses: numeric("road_expenses"), // FDR
  totalCost: numeric("total_cost"), // TOTAL
  fuelPricePerLiter: numeric("fuel_price_per_liter").default(828),
}

logisticsExtras: {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  extraType: text("extra_type"), // Ration, Ligature, GPS
  amount: numeric("amount"),
  description: text("description"),
}
```

#### **Actions développement prioritaires :**

1. **Enrichissement fuelRecords** : Champs manquants depuis Excel
2. **Schema logistique** : Tables dailyLogisticsNeeds, logisticsExtras
3. **Règles de calcul** : Solde carburant, coûts automatiques
4. **Interface quotidienne** : Écran "Besoin du jour" comme Excel

---

### 🏪 **MODULE 5: FOURNISSEURS & ACHATS** 

#### **Fichiers Excel sources critiques :**

**1. GESTION DES FOURNISSEURS_1759164771749.docx**
- **Feuilles par fournisseur** : CFAO MOBILITY, ACCORD BOURGNE, BERNABE, etc.
- **RECAP GENERAL** : Synthèse par fournisseur
- **RECAP ANNUEL** : Synthèse mensuelle

**2. Gestion des Fournisseurs – Étude de l'existant**
- **12 fournisseurs identifiés** : Structure complète détaillée
- **Calculs automatiques** : TVA 19.25%, totaux, soldes

#### **Structure fournisseurs Excel → Yaro :**

**Fournisseurs identifiés Excel :**
```excel
CFAO MOBILITY, ACCORD BOURGNE, BERNABE, AUTO SERVICE
ONE WORLD BUSINESS S.A, ACTIVA, TOTAL ENERGIES
TRACTAFRIC MOTOR, ORANGE CAMEROUN, TECH CARE, MTN CAMEROON, AREC SARL
```

**Correspondance avec schema Yaro (développement nécessaire) :**
```typescript
// Schema actuel Yaro (minimal)
parts: {
  supplier: text("supplier"), // Champ basique ✅
}

// À développer pour correspondance Excel complète :
suppliers: {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  category: text("category"), // Assurance, Pièces, Télécom, etc.
  contactInfo: jsonb("contact_info"),
  paymentTerms: text("payment_terms"),
  isActive: boolean("is_active").default(true),
}

supplierInvoices: {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  invoiceNumber: text("invoice_number").unique(),
  invoiceDate: date("invoice_date"),
  family: text("family"), // FAMILLE Excel
  description: text("description"), // LIBELLÉ Excel
  quantity: text("quantity"), // QTÉ Excel
  amountHT: numeric("amount_ht"), // MONTANT Excel
  vatAmount: numeric("vat_amount"), // TVA calculée
  totalTTC: numeric("total_ttc"), // PAIEMENT Excel
  balance: numeric("balance").default(0), // SOLDE Excel
  paymentDate: date("payment_date"),
  paymentMethod: text("payment_method"), // MODE DE PAIEMENT Excel
  isPaymentComplete: boolean("is_payment_complete").default(false),
}

// Cas spécial assurance (ACTIVA) :
insuranceInvoices: {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  baseAmount: numeric("base_amount"), // MONTANT Excel
  accessories: numeric("accessories"), // ACCESSOIRES Excel
  centralFile: numeric("central_file"), // FICHIER CENTRAL Excel
  vatAmount: numeric("vat_amount"), // TVA sur base+accessoires+central
  pinkCards: numeric("pink_cards"), // CARTES ROSES Excel
  dta: numeric("dta"), // DTA Excel
  totalAmount: numeric("total_amount"), // PAIEMENT total
}
```

**Règles TVA Excel à reproduire :**
```excel
TVA = MONTANT × 0.1925 (fournisseurs normaux)
TVA = (MONTANT + ACCESSOIRES + FICHIER CENTRAL) × 0.1925 (assurance)
PAIEMENT = MONTANT + TVA (normal)
PAIEMENT = MONTANT + ACCESSOIRES + FICHIER CENTRAL + TVA + CARTES ROSES + DTA (assurance)
SOLDE = PAIEMENT - Montant_payé
```

#### **RECAP GENERAL Excel → Yaro :**

**Structure Excel :**
```excel
FOURNISSEURS, MONTANT TOTAL FACTURES, TVA, MONTANT TOTAL RÈGLEMENT, MONTANT TOTAL SOLDE
```

**Vue Yaro à créer :**
```sql
CREATE VIEW supplier_summary AS
SELECT 
  s.name as supplier_name,
  SUM(si.amount_ht) as total_invoices_ht,
  SUM(si.vat_amount) as total_vat,
  SUM(CASE WHEN si.is_payment_complete THEN si.total_ttc ELSE 0 END) as total_payments,
  SUM(si.balance) as total_balance
FROM suppliers s
LEFT JOIN supplier_invoices si ON s.id = si.supplier_id
GROUP BY s.id, s.name;
```

#### **RECAP ANNUEL Excel → Yaro :**

**Structure mensuelle Excel :**
```excel
Fournisseur, Solde, puis pour chaque mois : Montant HT, TVA, Solde
```

**Vue Yaro à créer :**
```sql
CREATE VIEW supplier_monthly_summary AS
SELECT 
  s.name as supplier_name,
  EXTRACT(MONTH FROM si.invoice_date) as month,
  EXTRACT(YEAR FROM si.invoice_date) as year,
  SUM(si.amount_ht) as month_amount_ht,
  SUM(si.vat_amount) as month_vat,
  SUM(si.balance) as month_balance
FROM suppliers s
LEFT JOIN supplier_invoices si ON s.id = si.supplier_id
GROUP BY s.id, s.name, EXTRACT(MONTH FROM si.invoice_date), EXTRACT(YEAR FROM si.invoice_date)
ORDER BY s.name, year, month;
```

#### **Actions développement prioritaires :**

1. **Migration fournisseurs** : Import 12 fournisseurs Excel identifiés
2. **Schema complet** : Tables suppliers, supplierInvoices, insuranceInvoices
3. **Calculs automatiques** : TVA 19.25%, totaux, soldes
4. **Vues synthèse** : RECAP GENERAL, RECAP ANNUEL
5. **Interface gestion** : Écrans par fournisseur comme Excel

---

## 🔄 **PROCESSUS MÉTIER EXISTANT EXCEL → YARO**

### **ACTEURS & RESPONSABILITÉS**

#### **👥 Rôles opérationnels identifiés :**

**1. Secrétaire :**
- Saisie données opérationnelles quotidiennes
- Gestion documentation (cartes grises, assurances)
- Suivi facturation clients
- Archivage et classement

**2. Logisticien :**
- Planification missions quotidiennes (BESOIN LOGISTIQUE)
- Calcul carburant + FDR par destination
- Coordination avec chauffeurs
- Suivi opérations clients (MAERSK, etc.)

**3. Magasinier :**
- Gestion stock pièces (STOCK)
- Entrées/sorties magasin
- Alertes CDE (commandes)
- Inventaire physique

**4. Maintenancier :**
- Interventions véhicules (MAINTENANCE)
- Suivi pneumatiques
- Consommation pièces
- Reporting interventions

**Correspondance Yaro (rôles à intégrer) :**
```typescript
// Extension des rôles existants
enum UserRole {
  ADMIN = "admin",
  WORKSHOP_MANAGER = "workshop_manager", 
  TECHNICIAN = "technician",
  // Nouveaux rôles
  SECRETARY = "secretary",
  LOGISTICS = "logistics",
  WAREHOUSE = "warehouse",
  MAINTENANCE = "maintenance",
  CLIENT = "client",
}
```

### **1. FLUX OPÉRATIONNEL QUOTIDIEN**

#### **Matin - Planification (Excel actuel) :**
```
Logisticien → BESOIN LOGISTIQUE → Calcul carburant/FDR
Magasinier → STOCK → Vérification alertes CDE
Secrétaire → FACTURATION → Saisie opérations
Maintenancier → MAINTENANCE → Planning interventions
Responsable → TBD → Filtres mois/entité, actualisation
```

#### **Correspondance Yaro (à développer) :**
```
Logisticien → Dashboard "Besoin du jour" → Calcul automatique
Magasinier → Page stock avec alertes temps réel
Secrétaire → Interface facturation/documentation
Maintenancier → Planning maintenance interactif
Manager → Dashboard unifié avec filtres
```

### **2. FLUX MAINTENANCE (Excel → Yaro)**

#### **Excel actuel :**
```
Intervention → MAINTENANCE → CV calculé → Impact OPERATION
Pièce sortie → STOCK → Stock_reel recalculé → Alerte CDE
```

#### **Yaro (déjà implémenté + enrichissements) :**
```
Work Order → Coût calculé → Impact rentabilité ✅
Pièce utilisée → Stock automatique → Alertes ✅
+ Ajout : Correspondance exacte colonnes Excel
```

### **3. FLUX CARBURANT (Excel → Yaro)**

#### **Excel actuel :**
```
Plein → CONSOMMATION → Débit calculé → Solde carburant
Mission → BESOIN LOGISTIQUE → FDR + carburant → Total jour
```

#### **Yaro (à enrichir) :**
```
Fuel Record → Prix enrichi ✅ → Solde à ajouter
Daily Need → Interface à créer → Calculs Excel
```

### **4. FLUX FOURNISSEURS (Excel → Yaro)**

#### **Excel actuel :**
```
Facture fournisseur → Feuille individuelle → TVA 19.25% → RECAP GENERAL
```

#### **Yaro (à développer) :**
```
Supplier Invoice → Calcul automatique → Vue synthèse
```

---

## 📊 **DASHBOARD CIBLES EXCEL → YARO**

### **Tableau de Bord TBD Excel :**

**Tuiles existantes :**
- CA global (tuile verte)
- C.A Achat Local (tuile rouge) 
- Taux Achat Local (donut)
- Valeur Magasin (tuile bas gauche)
- Les meilleurs clients (tuile verte centrale)
- C.A Garantie (bloc bleu)

**Correspondance Dashboard Yaro :**
```typescript
// Widgets à créer pour correspondance exacte
const dashboardWidgets = [
  { type: "tile", title: "CA Global", color: "green", value: totalRevenue },
  { type: "tile", title: "CA Achat Local", color: "red", value: localPurchases },
  { type: "donut", title: "Taux Achat Local", value: localPurchaseRate },
  { type: "tile", title: "Valeur Magasin", color: "blue", value: stockValue },
  { type: "list", title: "Meilleurs Clients", data: topClients },
  { type: "tile", title: "CA Garantie", color: "blue", value: warrantyRevenue },
];
```

### **Filtres Excel → Yaro :**

**Excel :**
- MOIS2 (janv., fév., ...)
- ENTITÉ (local)
- TRANSACTION (Entrée/Sortie/Stock)

**Yaro :**
```typescript
const dashboardFilters = {
  month: { type: "select", options: months },
  entity: { type: "select", options: entities },
  transactionType: { type: "select", options: ["ENTRÉE", "SORTIE", "STOCK"] },
};
```

---

## 🎯 **PLAN DE MIGRATION DONNÉES EXCEL → YARO**

### **Phase 1 : Extraction données Excel**

#### **Scripts d'import prioritaires :**

**1. Véhicules (SUIVI DES CAMION TAY.xlsx) :**
```typescript
const importVehicles = async (excelData) => {
  const vehicles = excelData.map(row => ({
    registrationNumber: row["N° Camions"],
    numeroVecteur: row["N° Camions"], 
    currentKilometers: row["Kilométrage actuel"],
    nextMaintenanceKm: row["Prochain Kilométrage"],
    location: row["Lieu"],
    position: row["Position"],
  }));
  // Insert into vehicles table
};
```

**2. Stock pièces (EXEMPLAIRE SUIVI MAINTENANCE.xlsm) :**
```typescript
const importParts = async (tListesData) => {
  const parts = tListesData.map(row => ({
    reference: row["REFERENCE"],
    name: row["LIBELLE FR"], 
    quantity: row["STOCK"],
    minQuantity: row["STOCK DE SECURITE"],
    category: row["GROUPE_ARTICLES"],
    location: row["LIEU"],
  }));
  // Insert into parts table
};
```

**3. Fournisseurs (GESTION FOURNISSEURS.xlsx) :**
```typescript
const importSuppliers = async () => {
  const suppliers = [
    "CFAO MOBILITY", "ACCORD BOURGNE", "BERNABE", "AUTO SERVICE",
    "ONE WORLD BUSINESS S.A", "ACTIVA", "TOTAL ENERGIES",
    "TRACTAFRIC MOTOR", "ORANGE CAMEROUN", "TECH CARE", 
    "MTN CAMEROON", "AREC SARL"
  ].map(name => ({ name, isActive: true }));
  // Insert into suppliers table
};
```

**4. Personnel CPC (CPC ET HABILITATION.xlsx) :**
```typescript
const importDrivers = async (cpcData) => {
  const drivers = cpcData.map(row => ({
    employeeNumber: row["N°"],
    name: row["NOM DU CHAUFFEUR"],
    birthDate: row["DATE NAISSANCE"],
    cniExpiry: row["VALIDITÉ CNI"],
    licenseNumber: row["N° PERMIS"],
    licenseExpiry: row["VALIDITÉ PERMIS"],
    cpcTrainingDate: row["DATE FORMATION CPC"],
  }));
  // Insert into drivers table
};
```

### **Phase 2 : Validation cohérence**

#### **Contrôles automatiques :**

**1. Véhicules :**
```sql
-- Vérifier unicité immatriculations
SELECT registrationNumber, COUNT(*) 
FROM vehicles 
GROUP BY registrationNumber 
HAVING COUNT(*) > 1;

-- Contrôler cohérence kilométrages
SELECT * FROM vehicles 
WHERE currentKilometers > nextMaintenanceKm;
```

**2. Stock :**
```sql
-- Vérifier références uniques
SELECT reference, COUNT(*) 
FROM parts 
GROUP BY reference 
HAVING COUNT(*) > 1;

-- Contrôler stock négatif
SELECT * FROM parts 
WHERE quantity < 0;
```

**3. Fournisseurs :**
```sql
-- Vérifier noms uniques
SELECT name, COUNT(*) 
FROM suppliers 
GROUP BY name 
HAVING COUNT(*) > 1;
```

### **Phase 3 : Synchronisation formules Excel**

#### **Calculs automatiques à implémenter :**

**1. Stock temps réel :**
```typescript
const calculateRealStock = async (partId: number) => {
  const movements = await db.query(`
    SELECT 
      SUM(CASE WHEN movement_type = 'ENTRÉE' THEN quantity ELSE 0 END) -
      SUM(CASE WHEN movement_type = 'SORTIE' THEN quantity ELSE 0 END) as real_stock
    FROM stock_movements 
    WHERE part_id = $1
  `, [partId]);
  
  return movements[0].real_stock;
};
```

**2. Solde carburant :**
```typescript
const calculateFuelBalance = async (vehicleId: number) => {
  const records = await db.query(`
    SELECT 
      SUM(credit_amount) - SUM(debit_amount) as balance
    FROM fuel_records 
    WHERE vehicle_id = $1 
    ORDER BY date
  `, [vehicleId]);
  
  return records[0].balance;
};
```

**3. Statut CPC :**
```typescript
const calculateCPCStatus = (cpcDate: Date): string => {
  if (!cpcDate) return "";
  
  const today = new Date();
  const expiryDate = new Date(cpcDate.getTime() + 731 * 24 * 60 * 60 * 1000);
  const warningDate = new Date(today.getTime() + 59 * 24 * 60 * 60 * 1000);
  
  if (expiryDate > today) {
    return expiryDate > warningDate ? "FORMÉ" : "À FORMER";
  }
  return "NON FORMÉ";
};
```

---

## 🚀 **PLAN D'EXÉCUTION PRIORITAIRE**

### **Semaine 1-2 : Enrichissement schémas existants**

#### **Modifications schema.ts prioritaires :**

**1. Table vehicles (enrichissement) :**
```typescript
export const vehicles = pgTable("vehicles", {
  // Champs existants ✅
  id: serial("id").primaryKey(),
  registrationNumber: text("registration_number").notNull().unique(),
  brand: text("brand").notNull(),
  model: text("model").notNull(),
  mileage: integer("mileage").default(0),
  
  // Nouveaux champs Excel ↓
  numeroVecteur: text("numero_vecteur"), // N° Camions Excel
  currentKilometers: integer("current_kilometers"), // Kilométrage actuel
  nextMaintenanceKm: integer("next_maintenance_km"), // Prochain Kilométrage
  locationCode: text("location_code"), // Lieu Excel
  maintenancePosition: text("maintenance_position"), // Position Excel
  lastMaintenanceDate: date("last_maintenance_date"), // Date dernière maintenance
});
```

**2. Table parts (enrichissement) :**
```typescript
export const parts = pgTable("parts", {
  // Champs existants ✅
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  reference: text("reference").notNull().unique(),
  quantity: integer("quantity").notNull().default(0),
  minQuantity: integer("min_quantity").notNull().default(5),
  unitPrice: numeric("unit_price", { precision: 15, scale: 2 }).notNull().default("0"),
  supplier: text("supplier"),
  
  // Nouveaux champs Excel ↓
  category: text("category"), // GROUPE_ARTICLES Excel
  location: text("location"), // LIEU Excel
  responsiblePerson: text("responsible_person"), // MAGASIN_MECANICIEN Excel
  securityStock: integer("security_stock"), // STOCK_DE_SECURITE Excel explicite
  realStock: integer("real_stock").default(0), // STOCK_REEL calculé
  reorderAlert: boolean("reorder_alert").default(false), // Alerte CDE
});
```

**3. Table drivers (nouvelle) :**
```typescript
export const drivers = pgTable("drivers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  employeeNumber: text("employee_number").unique(), // N° Excel
  birthDate: date("birth_date"), // DATE NAISSANCE
  cniNumber: text("cni_number"), // CNI
  cniExpiry: date("cni_expiry"), // VALIDITÉ CNI
  licenseNumber: text("license_number"), // N° PERMIS
  licenseExpiry: date("license_expiry"), // VALIDITÉ PERMIS
  geoTrainingDate: date("geo_training_date"), // FORMATION GEO
  cpcTrainingDate: date("cpc_training_date"), // DATE FORMATION CPC
  cpcStatus: text("cpc_status"), // STATUT calculé
  cpcStatusUpdatedAt: timestamp("cpc_status_updated_at"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**4. Table suppliers (nouvelle) :**
```typescript
export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  category: text("category"), // Assurance, Pièces, Télécom
  contactInfo: jsonb("contact_info"),
  paymentTerms: integer("payment_terms").default(30),
  vatNumber: text("vat_number"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const supplierInvoices = pgTable("supplier_invoices", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  invoiceNumber: text("invoice_number").notNull().unique(),
  invoiceDate: date("invoice_date").notNull(),
  family: text("family"), // FAMILLE Excel
  description: text("description"), // LIBELLÉ Excel
  quantity: text("quantity"), // QTÉ Excel
  amountHT: numeric("amount_ht", { precision: 15, scale: 2 }).notNull(),
  vatAmount: numeric("vat_amount", { precision: 15, scale: 2 }),
  totalTTC: numeric("total_ttc", { precision: 15, scale: 2 }),
  balance: numeric("balance", { precision: 15, scale: 2 }).default(0),
  paymentDate: date("payment_date"),
  paymentMethod: text("payment_method"),
  isPaymentComplete: boolean("is_payment_complete").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### **Semaine 3-4 : Services enrichis**

#### **Services prioritaires à créer/enrichir :**

**1. VehicleService enrichi :**
```typescript
class VehicleService {
  // Méthodes existantes ✅
  
  // Nouvelles méthodes Excel
  async updateKilometers(vehicleId: number, currentKm: number) {
    const remainingKm = await this.calculateRemainingMaintenanceKm(vehicleId, currentKm);
    return db.update(vehicles).set({ 
      currentKilometers: currentKm,
      mileage: currentKm // Sync avec champ existant
    }).where(eq(vehicles.id, vehicleId));
  }
  
  async calculateRemainingMaintenanceKm(vehicleId: number, currentKm: number) {
    const vehicle = await this.getById(vehicleId);
    return vehicle.nextMaintenanceKm - currentKm;
  }
  
  async getMaintenanceAlerts() {
    return db.select().from(vehicles)
      .where(sql`current_kilometers >= next_maintenance_km - 1000`); // Alerte 1000km avant
  }
}
```

**2. StockService enrichi :**
```typescript
class StockService {
  async calculateRealStock(partId: number) {
    const result = await db.execute(sql`
      SELECT 
        COALESCE(SUM(CASE WHEN movement_type = 'ENTRÉE' THEN quantity ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN movement_type = 'SORTIE' THEN quantity ELSE 0 END), 0) as real_stock
      FROM stock_movements 
      WHERE part_id = ${partId}
    `);
    
    const realStock = result[0]?.real_stock || 0;
    
    // Mise à jour temps réel
    await db.update(parts).set({ realStock }).where(eq(parts.id, partId));
    
    return realStock;
  }
  
  async checkReorderAlerts() {
    return db.select().from(parts)
      .where(sql`real_stock <= min_quantity`);
  }
  
  async getStockValueByLocation() {
    return db.execute(sql`
      SELECT 
        location,
        SUM(real_stock * unit_price) as total_value
      FROM parts 
      GROUP BY location
    `);
  }
}
```

**3. SupplierService (nouveau) :**
```typescript
class SupplierService {
  async createInvoice(data: SupplierInvoiceData) {
    const vatAmount = data.amountHT * 0.1925; // TVA 19.25% Excel
    const totalTTC = data.amountHT + vatAmount;
    
    return db.insert(supplierInvoices).values({
      ...data,
      vatAmount,
      totalTTC,
      balance: totalTTC, // Solde initial = total
    });
  }
  
  async processPayment(invoiceId: number, paymentAmount: number, paymentDate: Date, method: string) {
    const invoice = await this.getInvoiceById(invoiceId);
    const newBalance = invoice.balance - paymentAmount;
    const isComplete = newBalance <= 0;
    
    return db.update(supplierInvoices).set({
      balance: newBalance,
      paymentDate: isComplete ? paymentDate : invoice.paymentDate,
      paymentMethod: method,
      isPaymentComplete: isComplete,
    }).where(eq(supplierInvoices.id, invoiceId));
  }
  
  async getGeneralRecap() {
    return db.execute(sql`
      SELECT 
        s.name as supplier_name,
        SUM(si.amount_ht) as total_invoices_ht,
        SUM(si.vat_amount) as total_vat,
        SUM(CASE WHEN si.is_payment_complete THEN si.total_ttc ELSE 0 END) as total_payments,
        SUM(si.balance) as total_balance
      FROM suppliers s
      LEFT JOIN supplier_invoices si ON s.id = si.supplier_id
      GROUP BY s.id, s.name
      ORDER BY s.name
    `);
  }
}
```

**4. DriverService (nouveau) :**
```typescript
class DriverService {
  async updateCPCStatus(driverId: number) {
    const driver = await this.getById(driverId);
    const status = this.calculateCPCStatus(driver.cpcTrainingDate);
    
    return db.update(drivers).set({
      cpcStatus: status,
      cpcStatusUpdatedAt: new Date(),
    }).where(eq(drivers.id, driverId));
  }
  
  private calculateCPCStatus(cpcDate: Date | null): string {
    if (!cpcDate) return "";
    
    const today = new Date();
    const expiryDate = new Date(cpcDate.getTime() + 731 * 24 * 60 * 60 * 1000);
    const warningDate = new Date(today.getTime() + 59 * 24 * 60 * 60 * 1000);
    
    if (expiryDate > today) {
      return expiryDate > warningDate ? "FORMÉ" : "À FORMER";
    }
    return "NON FORMÉ";
  }
  
  async getCPCAlerts() {
    return db.select().from(drivers)
      .where(or(
        eq(drivers.cpcStatus, "À FORMER"),
        eq(drivers.cpcStatus, "NON FORMÉ")
      ));
  }
}
```

### **Semaine 5-6 : Interfaces utilisateur**

#### **Pages prioritaires à créer/adapter :**

**1. Dashboard unifié (style TBD Excel) :**
```typescript
// client/src/pages/dashboard/unified.tsx
const UnifiedDashboard = () => {
  const [filters, setFilters] = useState({
    month: new Date().getMonth() + 1,
    entity: "local",
    transactionType: "all"
  });
  
  const { data: stockValue } = useQuery({
    queryKey: ['stock-value', filters],
    queryFn: () => fetch('/api/stock/value').then(r => r.json())
  });
  
  const { data: topClients } = useQuery({
    queryKey: ['top-clients', filters],
    queryFn: () => fetch('/api/clients/top').then(r => r.json())
  });
  
  return (
    <div className="dashboard-grid">
      <DashboardTile title="Valeur Magasin" value={stockValue} color="blue" />
      <DashboardDonut title="Taux Achat Local" data={localPurchaseData} />
      <TopClientsList clients={topClients} />
      <MaintenanceAlerts />
      <StockAlerts />
    </div>
  );
};
```

**2. Gestion stock avec alertes (style Excel) :**
```typescript
// client/src/pages/stock/excel-style.tsx
const StockManagementExcel = () => {
  const { data: parts } = useQuery({
    queryKey: ['parts-with-alerts'],
    queryFn: () => fetch('/api/parts/with-alerts').then(r => r.json())
  });
  
  const { data: movements } = useQuery({
    queryKey: ['stock-movements'],
    queryFn: () => fetch('/api/stock/movements').then(r => r.json())
  });
  
  return (
    <div className="stock-excel-layout">
      <StockMovementForm onSubmit={handleMovementSubmit} />
      <StockTable 
        parts={parts}
        showAlerts={true}
        onPartUpdate={handlePartUpdate}
      />
      <StockAlertsPanel alerts={parts?.filter(p => p.reorderAlert)} />
    </div>
  );
};
```

**3. Fournisseurs avec calculs Excel :**
```typescript
// client/src/pages/suppliers/excel-management.tsx
const SupplierManagementExcel = () => {
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => fetch('/api/suppliers').then(r => r.json())
  });
  
  const { data: recap } = useQuery({
    queryKey: ['suppliers-recap'],
    queryFn: () => fetch('/api/suppliers/recap').then(r => r.json())
  });
  
  return (
    <div className="suppliers-excel-layout">
      <SuppliersList 
        suppliers={suppliers}
        onSelect={setSelectedSupplier}
      />
      {selectedSupplier && (
        <SupplierInvoices 
          supplierId={selectedSupplier.id}
          vatRate={0.1925} // TVA Excel 19.25%
        />
      )}
      <SupplierRecapGeneral data={recap} />
    </div>
  );
};
```

### **Semaine 7-8 : Migration et tests**

#### **Scripts de migration finale :**

**1. Migration complète Excel → Yaro :**
```bash
# Script de migration
npm run migrate:excel-import
npm run validate:data-consistency  
npm run test:excel-formulas
npm run db:push --force
```

**2. Validation des calculs :**
```typescript
// Tests de correspondance Excel
describe('Excel Formula Correspondence', () => {
  test('Stock réel calculation matches Excel', async () => {
    const partId = 1;
    const yaroStock = await StockService.calculateRealStock(partId);
    const excelStock = calculateStockFromMovements(movements);
    expect(yaroStock).toBe(excelStock);
  });
  
  test('TVA calculation matches Excel 19.25%', async () => {
    const amountHT = 1000000;
    const yaroVAT = SupplierService.calculateVAT(amountHT);
    const excelVAT = amountHT * 0.1925;
    expect(yaroVAT).toBe(excelVAT);
  });
  
  test('CPC status matches Excel formula', async () => {
    const cpcDate = new Date('2024-01-01');
    const yaroStatus = DriverService.calculateCPCStatus(cpcDate);
    const excelStatus = calculateCPCStatusExcel(cpcDate);
    expect(yaroStatus).toBe(excelStatus);
  });
});
```

---

## 📈 **INDICATEURS DE SUCCÈS MIGRATION**

### **KPI Technique :**
- ✅ **100% correspondance** calculs Excel vs Yaro
- ✅ **Migration données** sans perte (véhicules, stock, fournisseurs)
- ✅ **Performance** : Requêtes <500ms (vs calculs Excel lents)
- ✅ **Temps réel** : Mises à jour instantanées (vs actualisation manuelle Excel)

### **KPI Utilisateur :**
- ✅ **Interface familière** : Reprend logique navigation Excel
- ✅ **Calculs automatiques** : Plus de formules manuelles
- ✅ **Alertes proactives** : CDE, maintenance, CPC, etc.
- ✅ **Données centralisées** : Fin des fichiers Excel dispersés

### **KPI Business :**
- ✅ **Gain temps 90%** : Consolidation automatique vs saisies multiples
- ✅ **Cohérence données** : Source unique vs fichiers désynchronisés  
- ✅ **Traçabilité** : Audit trail complet vs historique Excel limité
- ✅ **Évolutivité** : Base pour LOT 2 vs limite Excel

---

## 🎯 **CONCLUSION ET RECOMMANDATIONS**

### **Synthèse de l'analyse :**

L'existant Excel révèle un **système métier extrêmement riche et sophistiqué** avec des règles de gestion complexes, des calculs automatisés et des flux inter-connectés. Le **LOT 1 de Yaro FleetOS** possède déjà une **base technique solide (76% d'avancement)** qui peut parfaitement accueillir ces enrichissements.

### **Points de correspondance forts :**
- ✅ **Architecture compatible** : PostgreSQL + React peut reproduire toute la logique Excel
- ✅ **Modules alignés** : 5 modules LOT 1 correspondent aux 5 domaines Excel principaux
- ✅ **Données structurées** : Schémas Yaro extensibles pour accueillir champs Excel
- ✅ **Calculs reproductibles** : Formules Excel traduisibles en TypeScript/SQL

### **Recommandations prioritaires :**

**1. Approche incrémentale :**
- Enrichir les schémas existants plutôt que repartir de zéro
- Migrer les données Excel par étapes validées
- Conserver la logique métier Excel éprouvée

**2. Focus utilisateur :**
- Reproduire les interfaces Excel familières
- Conserver les mêmes calculs et résultats
- Ajouter la valeur temps réel et cohérence

**3. Plan d'exécution réaliste :**
- **8 semaines** pour correspondance complète Excel → Yaro
- **Phase 1** : Enrichissement schémas (2 semaines)
- **Phase 2** : Services et calculs (2 semaines)  
- **Phase 3** : Interfaces utilisateur (2 semaines)
- **Phase 4** : Migration et validation (2 semaines)

### **ROI attendu :**
Transformation d'un **système Excel performant mais limité** en **plateforme web moderne avec la même richesse fonctionnelle** + **gains productivité, cohérence et évolutivité**.

**Le LOT 1 enrichi avec la correspondance Excel constituera une base opérationnelle exceptionnelle, prête pour les développements LOT 2 (commercial/financier).**

---

*Document d'analyse exhaustive - 29 septembre 2025*  
*Correspondance LOT 1 Yaro FleetOS ↔ Existant Excel TAY*