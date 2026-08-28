# 🚀 PHASE 1 : ENRICHISSEMENT SCHÉMAS EXISTANTS
## Document de Résolution Détaillée - LOT 1 Yaro FleetOS
### Date : 29 septembre 2025

---

## 📋 **ÉTAT INITIAL DU SCHÉMA**

### **Analyse du fichier `shared/schema.ts` actuel :**

#### **✅ Tables existantes bien développées :**

**1. `vehicles` (lignes 43-68)**
- **Champs présents** : registrationNumber, brand, model, mileage, nextMaintenanceMileage, status
- **Champs manquants Excel** : numeroVecteur, currentKilometers, locationCode, maintenancePosition

**2. `parts` (lignes 195-206)**
- **Champs présents** : name, reference, quantity, minQuantity, location, unitPrice, supplier
- **Champs manquants Excel** : category, responsiblePerson, securityStock, realStock, reorderAlert

**3. `fuelRecords` (lignes 256-269)**
- **Champs présents** : vehicleId, date, quantity, cost, mileage
- **Champs manquants Excel** : recordNumber, supplierType, paymentMode, creditAmount, debitAmount, balance

**4. `users` (lignes 6-15)**
- **Système existant** : username, password, email, name, role
- **Extension nécessaire** : Table drivers séparée pour données chauffeurs/CPC

#### **❌ Tables manquantes à créer :**

**1. `drivers`** - Gestion personnel/CPC (données chauffeurs spécialisées)
**2. `suppliers`** - Gestion fournisseurs (12 fournisseurs identifiés Excel)
**3. `supplierInvoices`** - Factures fournisseurs avec TVA 19.25%
**4. `timeTracking`** - Système pointage mensuel avec codes JT, M, Mi, C, A, R, Re
**5. `monthlyTimeStats`** - Statistiques pointage calculées automatiquement

---

## 🎯 **PLAN D'EXÉCUTION PHASE 1**

### **ÉTAPE 1 : ENRICHISSEMENT TABLE `vehicles`**

#### **Champs à ajouter (correspondance Excel) :**

```typescript
// Champs existants ✅
registrationNumber, brand, model, mileage, nextMaintenanceMileage

// Nouveaux champs Excel ↓
numeroVecteur: text("numero_vecteur"), // N° Camions Excel
currentKilometers: integer("current_kilometers"), // Kilométrage actuel Excel  
locationCode: text("location_code"), // Lieu Excel
maintenancePosition: text("maintenance_position"), // Position Excel
lastMaintenanceDate: date("last_maintenance_date"), // Date dernière maintenance
```

#### **Justification :**
- **numeroVecteur** : Correspondance directe "N° Camions" Excel pour continuité
- **currentKilometers** : Séparé de mileage pour correspondance exacte Excel 
- **locationCode** : "Lieu" Excel pour localisation véhicules
- **maintenancePosition** : "Position" Excel pour état maintenance

#### **Règles de calcul à implémenter :**
```excel
Reste km = Prochain Kilométrage - Kilométrage actuel (Excel)
→ remainingKm = nextMaintenanceMileage - currentKilometers (Yaro)
```

### **ÉTAPE 2 : ENRICHISSEMENT TABLE `parts`**

#### **Champs à ajouter (correspondance Excel STOCK) :**

```typescript
// Champs existants ✅
name, reference, quantity, minQuantity, location, unitPrice, supplier

// Nouveaux champs Excel ↓
category: text("category"), // GROUPE_ARTICLES Excel
responsiblePerson: text("responsible_person"), // MAGASIN_MECANICIEN Excel
securityStock: integer("security_stock"), // STOCK_DE_SECURITE Excel explicite
realStock: integer("real_stock").default(0), // STOCK_REEL calculé
reorderAlert: boolean("reorder_alert").default(false), // Alerte CDE Excel
deliveryReceiptNumber: text("delivery_receipt_number"), // N_BL_BS Excel
```

#### **Justification :**
- **category** : "GROUPE_ARTICLES" Excel pour classification
- **responsiblePerson** : "MAGASIN_MECANICIEN" Excel pour responsabilité
- **realStock** : Calcul automatique mouvements comme Excel
- **reorderAlert** : Alerte "CDE" automatique si realStock ≤ securityStock

#### **Formules Excel à reproduire :**
```excel
STOCK_REEL = SOMME.SI.ENS([QTE];[TRANSACTION];"ENTRÉE") - SOMME.SI.ENS([QTE];[TRANSACTION];"SORTIE")
SITUATION = SI(STOCK_REEL <= STOCK_DE_SECURITE;"CDE";"")
```

### **ÉTAPE 3 : ENRICHISSEMENT TABLE `fuelRecords`**

#### **Champs à ajouter (correspondance Excel CONSOMMATION) :**

```typescript
// Champs existants ✅  
vehicleId, date, quantity, cost, mileage

// Nouveaux champs Excel ↓
recordNumber: text("record_number"), // N° Excel
month: integer("month"), // Mois Excel
supplierType: text("supplier_type"), // Fournisseur/approvisionnement Excel
paymentMode: text("payment_mode"), // Credit_comptant Excel
orderNumber: text("order_number"), // BON DE COMMANDE N° Excel
clientName: text("client_name"), // client Excel
checkNumber: text("check_number"), // Chèque N° Excel
destination: text("destination"), // Destination Excel
unitPrice: numeric("unit_price"), // Tarif Excel
creditAmount: numeric("credit_amount"), // Credit Excel
debitAmount: numeric("debit_amount"), // Debit Excel
balance: numeric("balance"), // Solde Excel
fuelBalance: numeric("fuel_balance"), // Solde Gasoil Excel
```

#### **Calculs Excel à reproduire :**
```excel
Debit = Litres × Tarif
Solde = Solde_précédent + Credit - Debit  
Solde Gasoil = Solde / Tarif
```

### **ÉTAPE 4 : CRÉATION TABLE `drivers`**

#### **Nouvelle table complète (correspondance Excel CPC) :**

```typescript
export const drivers = pgTable("drivers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  employeeNumber: text("employee_number").unique(), // N° Excel
  birthDate: date("birth_date"), // DATE NAISSANCE Excel
  cniNumber: text("cni_number"), // CNI Excel
  cniExpiry: date("cni_expiry"), // VALIDITÉ CNI Excel
  licenseNumber: text("license_number"), // N° PERMIS Excel
  licenseExpiry: date("license_expiry"), // VALIDITÉ PERMIS Excel
  geoTrainingDate: date("geo_training_date"), // FORMATION GEO Excel
  cpcTrainingDate: date("cpc_training_date"), // DATE FORMATION CPC Excel
  cpcStatus: text("cpc_status"), // STATUT calculé Excel
  cpcStatusUpdatedAt: timestamp("cpc_status_updated_at"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

#### **Formule CPC Excel à reproduire :**
```excel
=SI(I4="";"";SI(I4+731>AUJOURDHUI();SI(I4+731>(AUJOURDHUI()+59);"FORME";"A FORMER");"NON FORME"))
```

**En TypeScript :**
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

### **ÉTAPE 5 : CRÉATION TABLES `suppliers` ET `supplierInvoices`**

#### **Table suppliers (12 fournisseurs Excel identifiés) :**

```typescript
export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  category: text("category"), // Assurance, Pièces, Télécom, etc.
  contactInfo: jsonb("contact_info"),
  paymentTerms: integer("payment_terms").default(30),
  vatNumber: text("vat_number"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

#### **Table supplierInvoices (correspondance Excel facturation) :**

```typescript
export const supplierInvoices = pgTable("supplier_invoices", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  invoiceNumber: text("invoice_number").notNull().unique(),
  invoiceDate: date("invoice_date").notNull(),
  family: text("family"), // FAMILLE Excel
  description: text("description"), // LIBELLÉ Excel
  quantity: text("quantity"), // QTÉ Excel
  amountHT: numeric("amount_ht", { precision: 15, scale: 2 }).notNull(), // MONTANT Excel
  vatAmount: numeric("vat_amount", { precision: 15, scale: 2 }), // TVA calculée
  totalTTC: numeric("total_ttc", { precision: 15, scale: 2 }), // PAIEMENT Excel
  balance: numeric("balance", { precision: 15, scale: 2 }).default(0), // SOLDE Excel
  paymentDate: date("payment_date"),
  paymentMethod: text("payment_method"), // MODE DE PAIEMENT Excel
  isPaymentComplete: boolean("is_payment_complete").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

#### **Calculs TVA Excel à reproduire (19.25%) :**
```excel
TVA = MONTANT × 0.1925 (fournisseurs normaux)
PAIEMENT = MONTANT + TVA
SOLDE = PAIEMENT - Montant_payé
```

### **ÉTAPE 6 : CRÉATION TABLES POINTAGE PERSONNEL**

#### **Table timeTracking (codes pointage Excel) :**

```typescript
export const timeTracking = pgTable("time_tracking", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  date: date("date").notNull(),
  status: text("status").notNull(), // JT, M, Mi, C, A, R, Re (codes Excel)
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

#### **Table monthlyTimeStats (statistiques calculées Excel) :**

```typescript
export const monthlyTimeStats = pgTable("monthly_time_stats", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  workedDays: integer("worked_days").default(0), // NB.SI(JT) Excel
  sickDays: integer("sick_days").default(0), // NB.SI(M) Excel
  missionDays: integer("mission_days").default(0), // NB.SI(Mi) Excel
  leaveDays: integer("leave_days").default(0), // NB.SI(C) Excel
  absentDays: integer("absent_days").default(0), // NB.SI(A) Excel
  restDays: integer("rest_days").default(0), // NB.SI(R) Excel
  lateDays: integer("late_days").default(0), // NB.SI(Re) Excel
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

#### **Correspondance codes Excel :**
- **JT** : Journée Travaillée
- **M** : Maladie  
- **Mi** : Mission
- **C** : Congé
- **A** : Absent
- **R** : Repos
- **Re** : Retard

---

## 🔄 **SÉQUENCE D'IMPLÉMENTATION**

### **Ordre d'exécution obligatoire :**

**1. Enrichissement vehicles** → Impact minimal, table existante
**2. Enrichissement parts** → Impact minimal, table existante  
**3. Enrichissement fuelRecords** → Impact minimal, table existante
**4. Création drivers** → Nouvelle table, dépendance users
**5. Création suppliers** → Nouvelle table, indépendante
**6. Création supplierInvoices** → Dépendance suppliers
**7. Création timeTracking** → Dépendance users
**8. Création monthlyTimeStats** → Dépendance users
**9. Application db:push --force** → Synchronisation BD
**10. Tests cohérence** → Validation finale

### **Contraintes techniques :**

**Foreign Keys :**
- `drivers.userId` → `users.id`
- `supplierInvoices.supplierId` → `suppliers.id`  
- `timeTracking.userId` → `users.id`
- `monthlyTimeStats.userId` → `users.id`

**Index automatiques :**
- `drivers.employeeNumber` (unique)
- `suppliers.name` (unique)
- `supplierInvoices.invoiceNumber` (unique)

---

## 📊 **VALIDATION ET TESTS**

### **Tests de cohérence post-enrichissement :**

**1. Vérification Foreign Keys :**
```sql
-- Tous les drivers ont un userId valide
SELECT COUNT(*) FROM drivers d 
LEFT JOIN users u ON d.user_id = u.id 
WHERE u.id IS NULL;

-- Toutes les supplierInvoices ont un supplierId valide  
SELECT COUNT(*) FROM supplier_invoices si
LEFT JOIN suppliers s ON si.supplier_id = s.id
WHERE s.id IS NULL;
```

**2. Vérification contraintes uniques :**
```sql
-- Pas de doublons employeeNumber
SELECT employee_number, COUNT(*) 
FROM drivers 
GROUP BY employee_number 
HAVING COUNT(*) > 1;

-- Pas de doublons supplier name
SELECT name, COUNT(*) 
FROM suppliers 
GROUP BY name 
HAVING COUNT(*) > 1;
```

**3. Vérification calculs automatiques :**
```sql
-- Parts avec alertes CDE
SELECT reference, name, real_stock, security_stock
FROM parts  
WHERE reorder_alert = true;

-- Soldes fournisseurs corrects
SELECT s.name, SUM(si.balance) as total_balance
FROM suppliers s
LEFT JOIN supplier_invoices si ON s.id = si.supplier_id
GROUP BY s.id, s.name;
```

### **Données de test prioritaires :**

**1. Fournisseurs Excel identifiés :**
```sql
INSERT INTO suppliers (name, category, is_active) VALUES
('CFAO MOBILITY', 'Pièces', true),
('ACCORD BOURGNE', 'Pièces', true), 
('BERNABE', 'Pièces', true),
('AUTO SERVICE', 'Pièces', true),
('ONE WORLD BUSINESS S.A', 'Service', true),
('ACTIVA', 'Assurance', true),
('TOTAL ENERGIES', 'Carburant', true),
('TRACTAFRIC MOTOR', 'Pièces', true),
('ORANGE CAMEROUN', 'Télécom', true),
('TECH CARE', 'Technologie', true),
('MTN CAMEROON', 'Télécom', true),
('AREC SARL', 'Service', true);
```

**2. Véhicules Excel exemples :**
```sql
UPDATE vehicles SET 
  numero_vecteur = registration_number,
  current_kilometers = mileage,
  location_code = 'YAO001'
WHERE registration_number IN ('LTTR 263 AV', 'LTTR 181 AU', 'LTTR 211 AU');
```

---

## 🎯 **RÉSULTATS ATTENDUS PHASE 1**

### **Capacités nouvelles après enrichissement :**

**✅ Gestion véhicules enrichie :**
- Correspondance exacte nomenclature Excel (numeroVecteur)
- Calculs kilométrages comme Excel (currentKilometers vs nextMaintenanceMileage)
- Localisation et position maintenance

**✅ Stock intelligent :**
- Catégorisation pièces (category) comme Excel
- Calculs stock temps réel (realStock) reproduisant formules Excel
- Alertes automatiques CDE (reorderAlert) 

**✅ Carburant avancé :**
- Gestion complète soldes carburant comme Excel
- Traçabilité approvisionnements, commandes, paiements
- Calculs crédit/débit automatiques

**✅ Personnel/Habilitations :**
- Gestion complète données chauffeurs CPC
- Calculs automatiques statuts formation (FORMÉ/À FORMER/NON FORMÉ)
- Système pointage mensuel avec codes Excel

**✅ Fournisseurs professionnels :**
- 12 fournisseurs Excel intégrés
- Facturation avec TVA 19.25% automatique
- Gestion soldes et paiements comme Excel

### **Métriques de succès :**

- **100% correspondance** champs critiques Excel → Yaro
- **Formules reproductibles** : CPC, stock réel, TVA, soldes
- **Données migrables** : Véhicules, pièces, fournisseurs existants
- **Base solide** pour Phase 2 (interfaces utilisateur)

---

## 📋 **CHECKLIST VALIDATION PHASE 1**

### **Avant db:push :**
- [ ] Enrichissement vehicles (5 nouveaux champs)
- [ ] Enrichissement parts (6 nouveaux champs) 
- [ ] Enrichissement fuelRecords (13 nouveaux champs)
- [ ] Création drivers (12 champs)
- [ ] Création suppliers (7 champs)
- [ ] Création supplierInvoices (15 champs)
- [ ] Création timeTracking (7 champs)
- [ ] Création monthlyTimeStats (10 champs)

### **Après db:push :**
- [ ] Toutes les tables créées sans erreur
- [ ] Foreign keys fonctionnelles 
- [ ] Contraintes uniques respectées
- [ ] Insertion données test réussie
- [ ] Requêtes validation passées
- [ ] Aucune régression sur existant

### **Validation finale :**
- [ ] Schéma enrichi = correspondance Excel complète
- [ ] Calculs automatiques implémentables (Phase 2)
- [ ] Interface données cohérentes pour migration
- [ ] Base technique solide pour LOT 1 complet

---

*Document de résolution Phase 1 - 29 septembre 2025*  
*Enrichissement schémas Yaro FleetOS pour correspondance Excel complète*