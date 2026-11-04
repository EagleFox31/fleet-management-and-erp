import { pgTable, text, serial, date, integer, bigint, timestamp, boolean, foreignKey, real, jsonb, numeric, primaryKey, index, uniqueIndex, check, unique } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { PART_UNITS } from "./constants/parts";
import { WORK_ORDER_ITEM_STATUSES } from "./constants/work-order-items";

// Users and authentication
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role", {
    enum: [
      "admin",
      "workshop_manager", // Chef d'atelier - Gestion équipe, planning
      "technician",        // Technicien/Maintenancier - Interventions, pneumatiques
      "secretary",         // Secrétaire - Saisie, documentation, facturation
      "logistics",         // Logisticien - Planification missions, FDR
      "warehouse",         // Magasinier - Stock, alertes CDE
      "management",        // Direction - Vue exécutive lecture seule
      "client",
      "driver",  // Chauffeur - Interface mobile PWA dédiée
      "user"
    ]
  }).notNull().default("user"),
  pin: text("pin"), // Hashed 4-digit PIN for driver mobile login
  loginCount: integer("login_count").notNull().default(0),
  lastLoginAt: timestamp("last_login_at"),
  // Verrouillage après échecs de connexion (P-03). Écrits uniquement par la requête de
  // comptage atomique et par le déverrouillage admin ; la source du compteur est
  // `login_attempts_by_username`.
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  lastFailedLoginAt: timestamp("last_failed_login_at"),
  // Droit de sortie de stock en dérogation (chef d'atelier, magasin fermé).
  // Accordé par défaut, retirable par l'administrateur seul
  // (`PATCH /api/users/:id/stock-issue-permission`). Sans effet sur les autres rôles.
  canIssueStock: boolean("can_issue_stock").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"), // Soft delete
}, (table) => [
  // PIN en clair refusé en base : hash bcrypt ($2a$, $2b$, $2y$) ou NULL.
  // Jumelle de server/db/migrations/20261104_users_pin_bcrypt_check.sql (posée NOT VALID puis validée).
  check("users_pin_bcrypt_check", sql`${table.pin} IS NULL OR ${table.pin} ~ '^[$]2[aby][$]'`),
]);

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  loginCount: true,
  lastLoginAt: true,
  canIssueStock: true,
  createdAt: true,
  deletedAt: true,
});

// User onboarding tracking
export const userOnboarding = pgTable("user_onboarding", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  currentStep: integer("current_step").default(0),
  stepsCompleted: jsonb("steps_completed").default([]), // Array of completed step IDs
  mascotHidden: boolean("mascot_hidden").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserOnboardingSchema = createInsertSchema(userOnboarding).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Vehicles (poids lourds/camions)
export const vehicles = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  registrationNumber: text("registration_number").notNull().unique(),
  brand: text("brand").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  mileage: integer("mileage").notNull().default(0),
  lastMileage: integer("last_mileage").notNull().default(0), // Dernier kilométrage enregistré
  vehicleType: text("vehicle_type", { enum: ["tracteur", "porteur", "semi_remorque", "remorque", "utilitaire", "autre"] }).notNull().default("tracteur"),
  status: text("status", { enum: ["operational", "maintenance", "out_of_service"] }).notNull().default("operational"),
  fuelType: text("fuel_type", { enum: ["diesel", "petrol", "electric", "hybrid", "other"] }).notNull().default("diesel"),
  ownerId: integer("owner_id").references(() => users.id), // Propriétaire du véhicule (pour les clients)
  createdBy: integer("created_by").references(() => users.id), // Créateur de la fiche véhicule
  tonnage: real("tonnage"), // Capacité de charge en tonnes
  // Capacité totale des réservoirs en litres (FUEL3, règle tank-overflow). NULL = inconnue, règle muette.
  // CHECK vehicles_tank_capacity_l_positive en base (server/init-database.ts) : > 0 et fini.
  tankCapacityL: real("tank_capacity_l"),
  axleCount: integer("axle_count"), // Nombre d'essieux
  engineSpec: text("engine_spec"), // Spécifications du moteur
  vin: text("vin"), // Vehicle Identification Number
  purchaseDate: date("purchase_date"), // Date d'achat
  purchasePrice: numeric("purchase_price", { precision: 15, scale: 2 }), // Prix d'achat - précision de 15 chiffres dont 2 décimales
  nextMaintenanceDate: date("next_maintenance_date"),
  nextMaintenanceMileage: integer("next_maintenance_mileage"),
  licensePlateExpiry: date("license_plate_expiry"), // Date d'expiration de la plaque
  insuranceExpiry: date("insurance_expiry"), // Date d'expiration de l'assurance  
  technicalInspectionDate: date("technical_inspection_date"), // Date de visite technique
  notes: text("notes"), // Notes supplémentaires
  // === NOUVEAUX CHAMPS EXCEL CORRESPONDANCE ===
  numeroVecteur: text("numero_vecteur"), // N° Camions Excel - correspondance directe
  currentKilometers: integer("current_kilometers"), // Kilométrage actuel Excel - séparé de mileage 
  locationCode: text("location_code"), // Lieu Excel - localisation véhicule
  maintenancePosition: text("maintenance_position"), // Position Excel - état maintenance
  lastMaintenanceDate: date("last_maintenance_date"), // Date dernière maintenance pour calculs
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"), // Soft delete
});

// Table pour persister l'état des workflows d'acquisition de véhicules
export const vehicleAcquisitionWorkflows = pgTable("vehicle_acquisition_workflows", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  sessionId: text("session_id").notNull(), // Pour identifier la session unique
  currentStep: integer("current_step").notNull().default(1),
  workflowData: jsonb("workflow_data").notNull(), // Toutes les données du workflow
  uploadedFiles: jsonb("uploaded_files"), // Références aux fichiers uploadés
  status: text("status", { enum: ["in_progress", "completed", "abandoned"] }).notNull().default("in_progress"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// Documents uploadés pendant les workflows d'acquisition
export const workflowDocuments = pgTable("workflow_documents", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").notNull().references(() => vehicleAcquisitionWorkflows.id, { onDelete: 'cascade' }),
  sessionId: text("session_id").notNull(), // Référence à la session du workflow
  documentType: text("document_type", { enum: ["carte_grise", "assurance", "visite_technique", "factur_achat", "autre"] }).notNull(),
  originalName: text("original_name").notNull(), // Nom original du fichier
  storedName: text("stored_name").notNull(), // Nom du fichier stocké
  filePath: text("file_path").notNull(), // Chemin complet vers le fichier
  fileSize: integer("file_size").notNull(), // Taille en octets
  mimeType: text("mime_type").notNull(), // Type MIME
  uploadedBy: integer("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  vehicleId: integer("vehicle_id").references(() => vehicles.id), // Véhicule final créé (null si workflow non terminé)
  isTransferred: boolean("is_transferred").notNull().default(false), // Si transféré vers vehicle_documents
});

/** Bornes de saisie de la capacité des réservoirs (FUEL3). La base n'impose que > 0 : la borne haute est une règle de saisie. */
export const VEHICLE_TANK_CAPACITY_MIN_L = 1;
export const VEHICLE_TANK_CAPACITY_MAX_L = 2000;
export const VEHICLE_TANK_CAPACITY_MESSAGE =
  `La capacité totale des réservoirs doit être comprise entre ${VEHICLE_TANK_CAPACITY_MIN_L} et ${VEHICLE_TANK_CAPACITY_MAX_L} litres. Laisser le champ vide si elle est inconnue.`;

/**
 * Capacité des réservoirs en litres, réutilisable par la création et la modification d'un véhicule.
 * Absent = inchangé ; null ou "" = inconnue (vidée) ; sinon nombre entre les bornes.
 */
export const vehicleTankCapacitySchema = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((val) => {
    if (val === undefined) return undefined;
    if (val === null || (typeof val === "string" && val.trim() === "")) return null;
    return Number(val);
  })
  .refine(
    (n) => n === undefined || n === null || (Number.isFinite(n) && n >= VEHICLE_TANK_CAPACITY_MIN_L && n <= VEHICLE_TANK_CAPACITY_MAX_L),
    VEHICLE_TANK_CAPACITY_MESSAGE,
  );

export const insertVehicleSchema = createInsertSchema(vehicles).omit({
  id: true,
  createdBy: true,
  createdAt: true,
}).extend({
  purchaseDate: z.string().optional().transform((val) => val ? val : undefined),
  nextMaintenanceDate: z.string().optional().transform((val) => val ? val : undefined),
  licensePlateExpiry: z.string().optional().transform((val) => val ? val : undefined),
  insuranceExpiry: z.string().optional().transform((val) => val ? val : undefined),
  technicalInspectionDate: z.string().optional().transform((val) => val ? val : undefined),
  purchasePrice: z.union([z.string(), z.number()]).optional().transform((val) => val ? String(val) : undefined),
  // Un texte non numérique donnerait NaN, accepté ici puis refusé par la base (500) : refus en 400.
  tonnage: z.union([z.string(), z.number()]).optional().transform((val) => val ? Number(val) : undefined).refine((n) => n === undefined || Number.isFinite(n), "Nombre invalide"),
  axleCount: z.union([z.string(), z.number()]).optional().transform((val) => val ? Number(val) : undefined).refine((n) => n === undefined || Number.isFinite(n), "Nombre invalide"),
  mileage: z.union([z.string(), z.number()]).transform((val) => Number(val)).refine((n) => n === undefined || Number.isFinite(n), "Nombre invalide"),
  year: z.union([z.string(), z.number()]).transform((val) => Number(val)).refine((n) => n === undefined || Number.isFinite(n), "Nombre invalide"),
  nextMaintenanceMileage: z.union([z.string(), z.number()]).optional().transform((val) => val ? Number(val) : undefined).refine((n) => n === undefined || Number.isFinite(n), "Nombre invalide"),
  tankCapacityL: vehicleTankCapacitySchema,
});

// Documents attachés aux véhicules
export const vehicleDocuments = pgTable("vehicle_documents", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
  name: text("name").notNull(), // Nom du document
  type: text("type", { enum: ["carte_grise", "assurance", "visite_technique", "taxe", "autre"] }).notNull(), // Type de document
  description: text("description"), // Description ou notes sur le document
  filename: text("filename").notNull(), // Nom du fichier
  filesize: integer("filesize").notNull(), // Taille du fichier en octets
  fileType: text("file_type").notNull(), // Type MIME du fichier (ex: application/pdf)
  filePath: text("file_path").notNull(), // Chemin vers le fichier stocké
  uploadedBy: integer("uploaded_by").references(() => users.id), // Qui a téléchargé le document
  updatedBy: integer("updated_by").references(() => users.id), // Qui a modifié le document en dernier
  expiryDate: date("expiry_date"), // Date d'expiration du document (si applicable)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertVehicleDocumentSchema = createInsertSchema(vehicleDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Centres agréés pour renouvellement documentaire (proposés dans les demandes futures)
export const documentRenewalCenters = pgTable("document_renewal_centers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  documentType: text("document_type", { enum: ["carte_grise", "assurance", "visite_technique", "taxe", "autre"] }),
  accreditationNumber: text("accreditation_number"),
  address: text("address"),
  contact: text("contact"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDocumentRenewalCenterSchema = createInsertSchema(documentRenewalCenters).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Demandes de renouvellement documentaire (workflow lean: signalement -> traitement)
export const documentRenewalRequests = pgTable("document_renewal_requests", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  vehicleDocumentId: integer("vehicle_document_id").notNull().references(() => vehicleDocuments.id, { onDelete: "cascade" }),
  documentType: text("document_type", { enum: ["carte_grise", "assurance", "visite_technique", "taxe", "autre"] }).notNull(),
  status: text("status", { enum: ["pending", "in_progress", "completed", "rejected"] }).notNull().default("pending"),
  requestedBy: integer("requested_by").references(() => users.id),
  assignedRole: text("assigned_role", { enum: ["admin", "secretary", "logistics", "workshop_manager"] }),
  centerId: integer("center_id").references(() => documentRenewalCenters.id),
  centerNameSnapshot: text("center_name_snapshot"),
  centerAccreditationSnapshot: text("center_accreditation_snapshot"),
  escortRole: text("escort_role", { enum: ["driver", "technician"] }),
  // Peut référencer un chauffeur (table drivers) ou un technicien (table users),
  // donc on stocke l'ID sans contrainte FK unique.
  escortUserId: integer("escort_user_id"),
  targetDate: date("target_date"),
  comment: text("comment"),
  source: text("source").notNull().default("vehicle_document"),
  newExpiryDate: date("new_expiry_date"),
  renewalReference: text("renewal_reference"),
  renewalVisitDate: date("renewal_visit_date"),
  inspectorName: text("inspector_name"),
  inspectorCode: text("inspector_code"),
  proofFileName: text("proof_file_name"),
  proofFilePath: text("proof_file_path"),
  // Récépissé provisoire téléversé pendant la demande (P3-2) : rend le véhicule éligible
  // jusqu'à receiptValidUntil inclus. Distinct de proofFile*, la preuve de clôture (completed).
  // Date, chemin, nom et date de dépôt : tous NULL ou tous renseignés (CHECK
  // document_renewal_requests_receipt_complete) ; receiptUploadedBy peut rester NULL.
  receiptValidUntil: date("receipt_valid_until"),
  receiptFileName: text("receipt_file_name"),
  receiptFilePath: text("receipt_file_path"),
  receiptUploadedAt: timestamp("receipt_uploaded_at"),
  receiptUploadedBy: integer("receipt_uploaded_by").references(() => users.id),
  completedBy: integer("completed_by").references(() => users.id),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  check(
    "document_renewal_requests_receipt_complete",
    sql`num_nulls(${table.receiptValidUntil}, ${table.receiptFilePath}, ${table.receiptFileName}, ${table.receiptUploadedAt}) IN (0, 4)`,
  ),
]);

// Fichier et traçabilité du récépissé : posés par le serveur au téléversement (chemin issu de
// multer, AGENTS.md §9), jamais lus dans le corps de requête. Seule la date de validité est saisie.
export const insertDocumentRenewalRequestSchema = createInsertSchema(documentRenewalRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  receiptFileName: true,
  receiptFilePath: true,
  receiptUploadedAt: true,
  receiptUploadedBy: true,
});

// Maintenance schedules
export const maintenanceSchedules = pgTable("maintenance_schedules", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id),
  title: text("title").notNull(),
  description: text("description"),
  scheduledDate: date("scheduled_date"),
  scheduledMileage: integer("scheduled_mileage"),
  frequency: text("frequency", { enum: ["daily", "weekly", "monthly", "quarterly", "yearly", "mileage"] }).notNull(),
  frequencyValue: integer("frequency_value").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMaintenanceScheduleSchema = createInsertSchema(maintenanceSchedules).omit({
  id: true,
  createdAt: true,
});

// Work orders (interventions)
export const workOrders = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id),
  vehicleRegistration: text("vehicle_registration"),
  vehicleBrand: text("vehicle_brand"),
  vehicleModel: text("vehicle_model"),
  technicianId: integer("technician_id").references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  diagnosis: text("diagnosis"),
  status: text("status", { enum: ["pending", "in_progress", "awaiting_parts", "completed", "cancelled"] }).notNull().default("pending"),
  priority: text("priority", { enum: ["low", "medium", "high", "critical"] }).notNull().default("medium"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  duration: integer("duration"), // in minutes
  // Coût de BASE de l'intervention (main-d'œuvre), pas un total.
  // Les pièces ne sont PAS incluses ici: elles vivent dans `parts_used` et sont
  // additionnées à part (cf. `calculateWorkOrderCosts`). Y ajouter les pièces
  // les compterait deux fois dans le tableau de bord Direction, qui somme déjà
  // les factures fournisseurs.
  cost: numeric("cost", { precision: 15, scale: 2 }).default("0"),
  isPreventive: boolean("is_preventive").default(false),
  isFirstVisit: boolean("is_first_visit").default(false),
  maintenanceScheduleId: integer("maintenance_schedule_id").references(() => maintenanceSchedules.id),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // Contrôle qualité : colonnes qc_* dans `workOrderQuality` (fin de fichier).
  // Double affectation (P-08) : deux contraintes EXCLUDE (btree_gist) existent en SQL seulement,
  // work_orders_no_technician_overlap et work_orders_no_vehicle_overlap. Drizzle ne sait pas les
  // exprimer ; voir server/db/migrations/20261031_lot_recette.sql. Violation = SQLSTATE 23P01.
});

export const insertWorkOrderSchema = createInsertSchema(workOrders).omit({
  id: true,
  createdAt: true,
}).extend({
  startDate: z.string().optional().transform((val) => val ? new Date(val) : undefined),
  endDate: z.string().optional().transform((val) => val ? new Date(val) : undefined),
});

// Catalogue de main-d'œuvre: barème de comparaison, pas un tarif.
// Aucune colonne de prix ici, volontairement — cf. docs/plans/lignes-de-travail-ot.md.
export const laborCatalog = pgTable("labor_catalog", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  standardHours: numeric("standard_hours", { precision: 5, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertLaborCatalogSchema = createInsertSchema(laborCatalog).omit({
  id: true,
  createdBy: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true,
});

// Lignes de travail d'un OT: qui a passé combien de temps sur quoi.
// Table fille — n'ajoute aucun état au cycle de `work_orders`.
export const workOrderItems = pgTable("work_order_items", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  laborCatalogId: integer("labor_catalog_id").references(() => laborCatalog.id, { onDelete: "set null" }),
  // Obligatoire quand la ligne ne pointe pas un poste catalogue: sans libellé,
  // l'historique du camion devient illisible.
  customLabel: text("custom_label"),
  technicianId: integer("technician_id").references(() => users.id, { onDelete: "set null" }),
  estimatedHours: numeric("estimated_hours", { precision: 5, scale: 2 }),
  // La donnée qui manquait: `work_orders.duration` porte une seule durée pour
  // toute l'intervention, impossible d'y lire qui a fait quoi.
  actualHours: numeric("actual_hours", { precision: 5, scale: 2 }),
  status: text("status", { enum: WORK_ORDER_ITEM_STATUSES }).notNull().default("pending"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertWorkOrderItemSchema = createInsertSchema(workOrderItems).omit({
  id: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

// Parts inventory
export const parts = pgTable("parts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  reference: text("reference").notNull().unique(),
  description: text("description"),
  quantity: integer("quantity").notNull().default(0),
  minQuantity: integer("min_quantity").notNull().default(5),
  unit: text("unit").notNull().default("pièce"),
  location: text("location"),
  unitPrice: numeric("unit_price", { precision: 15, scale: 2 }).notNull().default("0"),
  // Rattachement fournisseur: `supplierId` est la vérité. `supplier` (nom en clair)
  // est conservé en transition pour l'affichage des pièces non encore rattachées
  // et pour la reprise historique. Ne plus l'utiliser comme clé de regroupement.
  supplierId: integer("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  supplier: text("supplier"),
  // === NOUVEAUX CHAMPS EXCEL CORRESPONDANCE ===
  category: text("category"), // GROUPE_ARTICLES Excel - classification pièces
  responsiblePerson: text("responsible_person"), // MAGASIN_MECANICIEN Excel - responsable magasin
  realStock: integer("real_stock").default(0), // STOCK_REEL Excel - calculé automatiquement
  reorderAlert: boolean("reorder_alert").default(false), // Alerte CDE Excel - si quantity <= minQuantity
  deliveryReceiptNumber: text("delivery_receipt_number"), // N_BL_BS Excel - numéro bon livraison
  createdBy: integer("created_by").references(() => users.id), // Créateur de la fiche pièce
  updatedBy: integer("updated_by").references(() => users.id), // Dernier modificateur
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPartSchema = createInsertSchema(parts).omit({
  id: true,
  createdBy: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  unit: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.enum(PART_UNITS),
  ).optional().default("pièce"),
  unitPrice: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Le prix unitaire doit être un nombre positif.")
    .optional()
    .default("0"),
  quantity: z.number().int().min(0, "Le stock ne peut pas être négatif.").optional().default(0),
  minQuantity: z.number().int().min(0, "Le seuil minimum ne peut pas être négatif.").optional().default(5),
  description: z.string().optional(),
  location: z.string().optional(),
  supplier: z.string().optional(),
});

// Parts used in work orders
export const partsUsed = pgTable("parts_used", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull().references(() => workOrders.id),
  partId: integer("part_id").notNull().references(() => parts.id),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPartUsedSchema = createInsertSchema(partsUsed).omit({
  id: true,
  createdAt: true,
});

// Parts stock movements history
export const partsStockMovements = pgTable("parts_stock_movements", {
  id: serial("id").primaryKey(),
  partId: integer("part_id").notNull().references(() => parts.id),
  movementType: text("movement_type", { enum: ["in", "out", "adjustment", "initial"] }).notNull(),
  quantity: integer("quantity").notNull(),
  previousStock: integer("previous_stock").notNull(),
  newStock: integer("new_stock").notNull(),
  workOrderId: integer("work_order_id").references(() => workOrders.id), // Si lié à un OT
  reason: text("reason"), // Raison du mouvement
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPartsStockMovementSchema = createInsertSchema(partsStockMovements).omit({
  id: true,
  createdAt: true,
});

// Fuel records
export const fuelRecords = pgTable("fuel_records", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").references(() => vehicles.id), // Nullable pour recharges carte
  missionId: integer("mission_id").references(() => missions.id, { onDelete: "set null" }),
  date: date("date"),
  quantity: real("quantity").notNull(), // in liters
  cost: numeric("cost", { precision: 15, scale: 2 }),
  mileage: integer("mileage"), // Nullable car pas toujours disponible
  fuelType: text("fuel_type", { enum: ["diesel", "petrol", "electric", "hybrid", "other"] }).default("diesel"),
  stationName: text("station_name"), // Nom de la station ou "APPROVISIONNEMENT"
  fullTank: boolean("full_tank").default(true),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  // === NOUVEAUX CHAMPS EXCEL CORRESPONDANCE CONSOMMATION ===
  recordNumber: text("record_number"), // N° Excel - numéro d'enregistrement
  month: integer("month"), // Mois Excel - pour filtrage temporel
  year: integer("year"), // Année Excel - critique pour calculs multi-années
  supplierType: text("supplier_type"), // Fournisseur/approvisionnement Excel
  paymentMode: text("payment_mode"), // Credit_comptant Excel - mode paiement
  orderNumber: text("order_number"), // BON DE COMMANDE N° Excel
  clientName: text("client_name"), // client Excel - si applicable
  checkNumber: text("check_number"), // Chèque N° Excel - pour paiements
  destination: text("destination"), // Destination Excel - lieu livraison
  unitPrice: numeric("unit_price", { precision: 15, scale: 2 }), // Tarif Excel - prix par litre
  creditAmount: numeric("credit_amount", { precision: 15, scale: 2 }), // Credit Excel - montant crédit
  debitAmount: numeric("debit_amount", { precision: 15, scale: 2 }), // Debit Excel - montant débit
  balance: numeric("balance", { precision: 15, scale: 2 }), // Solde Excel - solde comptable
  fuelBalance: numeric("fuel_balance", { precision: 15, scale: 2 }), // Solde Gasoil Excel - solde en litres
  // Validation des bons (P-17). Défaut SQL 'pending' ; les pleins antérieurs au lot sont 'validated'.
  validationStatus: text("validation_status", { enum: ["pending", "validated"] }).notNull().default("pending"),
  validatedBy: integer("validated_by").references(() => users.id),
  validatedAt: timestamp("validated_at"),
  // Clé de requête d'un plein de mission, posée par le serveur seul : un nouvel envoi est rejoué
  // au lieu de débiter deux fois (server/db/migrations/20261103_fuel_records_request_key.sql).
  requestKey: text("request_key"),
  // Suppression douce d'une ligne qui a mouvementé la carte : posée par le serveur seul, la ligne reste
  // pour l'audit mais n'entre plus dans aucun solde ni somme (server/db/migrations/20261103_fuel_records_soft_delete.sql).
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [uniqueIndex("ux_fuel_records_request_key").on(table.requestKey)]);

export const insertFuelRecordSchema = createInsertSchema(fuelRecords).omit({
  id: true,
  requestKey: true,
  deletedAt: true,
  deletedBy: true,
  validatedBy: true,
  validatedAt: true,
  createdAt: true,
  updatedAt: true,
});

// Alerts
export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  title: text("title").notNull(),
  message: text("message").notNull(),
  // `procurement`: achats et fournisseurs (fiche à compléter, commande non
  // confirmée, facture en retard...). La colonne est un `text` sans contrainte
  // CHECK en base: étendre cet enum est un changement purement TypeScript.
  type: text("type", { enum: ["maintenance", "inventory", "work_order", "fuel", "mission", "procurement"] }).notNull(),
  priority: text("priority", { enum: ["low", "medium", "high", "critical"] }).notNull().default("medium"),
  isRead: boolean("is_read").notNull().default(false),
  link: text("link"),
  // Thème de notification (P-12), nul pour les alertes antérieures. Le filtre lit
  // `notification_preferences` : l'absence de ligne vaut « actif ».
  topic: text("topic"),
  // Déduplication des alertes générées (P-05) : index unique partiel (user_id, dedupe_key).
  dedupeKey: text("dedupe_key"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAlertSchema = createInsertSchema(alerts).omit({
  id: true,
  isRead: true,
  createdAt: true,
});

// Cache des KPI de flotte pour optimiser les performances
export const fleetKpiCache = pgTable("fleet_kpi_cache", {
  id: serial("id").primaryKey(),
  availabilityRate: real("availability_rate").notNull().default(0),
  mtbf: real("mtbf").notNull().default(0), // Mean Time Between Failures (jours)
  mttr: real("mttr").notNull().default(0), // Mean Time To Repair (heures)
  maintenanceCostPerVehicle: numeric("maintenance_cost_per_vehicle", { precision: 15, scale: 2 }).notNull().default('0'),
  downtimeHours: integer("downtime_hours").notNull().default(0),
  totalVehicles: integer("total_vehicles").notNull().default(0),
  operationalVehicles: integer("operational_vehicles").notNull().default(0),
  maintenanceVehicles: integer("maintenance_vehicles").notNull().default(0),
  outOfServiceVehicles: integer("out_of_service_vehicles").notNull().default(0),
  totalWorkOrders: integer("total_work_orders").notNull().default(0),
  completedWorkOrders: integer("completed_work_orders").notNull().default(0),
  correctiveWorkOrders: integer("corrective_work_orders").notNull().default(0),
  totalMaintenanceCost: numeric("total_maintenance_cost", { precision: 15, scale: 2 }).notNull().default('0'),
  calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Besoins en pièces (Part Requirements)
export const partRequirements = pgTable("part_requirements", {
  id: serial("id").primaryKey(),
  partId: integer("part_id").references(() => parts.id),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  workOrderId: integer("work_order_id").references(() => workOrders.id),
  variantId: integer("variant_id").references(() => partVariants.id),
  quantityNeeded: integer("quantity_needed").notNull(),
  reason: text("reason").notNull(),
  urgency: text("urgency", { enum: ["low", "medium", "high", "critical"] }).notNull().default("medium"),
  status: text("status", { 
    enum: [
      "pending",           // En attente d'approbation
      "approved",          // Approuvée par le chef d'atelier/admin
      "rejected",          // Rejetée
      "ordered",           // Commandée auprès du fournisseur
      "partially_received",// Réception partielle en magasin
      "received",          // Réception totale en magasin
      "issued",            // Pièce sortie du stock pour OT
      "fulfilled",         // Pièce installée, OT clôturé
      "cancel_requested",  // Demande d'annulation après commande
      "cancelled",         // Annulée
      "partial",           // Rétrocompatibilité: Livraison partielle
      "delivered"          // Rétrocompatibilité: Livrée
    ] 
  }).notNull().default("pending"),
  requestedBy: integer("requested_by").references(() => users.id),
  // Magasinier (ou admin) qui a enregistré l'entrée en stock : posé par le serveur.
  receivedBy: integer("received_by").references(() => users.id),
  estimatedCost: numeric("estimated_cost", { precision: 15, scale: 2 }),
  supplierNotes: text("supplier_notes"),
  expectedDeliveryDate: date("expected_delivery_date"),
  actualDeliveryDate: date("actual_delivery_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPartRequirementSchema = createInsertSchema(partRequirements).omit({
  id: true,
  receivedBy: true,
  createdAt: true,
  updatedAt: true,
});

// Catégories de pièces
export const partCategories = pgTable("part_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  parentCategoryId: integer("parent_category_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Spécifications de pièces
export const partSpecifications = pgTable("part_specifications", {
  id: serial("id").primaryKey(),
  partId: integer("part_id").references(() => parts.id, { onDelete: "cascade" }),
  specificationName: text("specification_name").notNull(),
  specificationValue: text("specification_value").notNull(),
  unit: text("unit"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_part_specifications_part_id").on(table.partId),
  // Colonnes écrites en sql`` dans un index à expression : voir tests/unit/shared/schema-index-introspection.test.ts.
  uniqueIndex("ux_part_specifications_name_part").on(sql`lower(${table.specificationName})`, sql`${table.partId}`),
]);

// Variantes de pièces
export const partVariants = pgTable("part_variants", {
  id: serial("id").primaryKey(),
  partId: integer("part_id").references(() => parts.id, { onDelete: "cascade" }),
  variantName: text("variant_name").notNull(),
  variantCode: text("variant_code").notNull().unique(),
  additionalPrice: numeric("additional_price", { precision: 10, scale: 2 }).default("0"),
  isAvailable: boolean("is_available").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_part_variants_part_id").on(table.partId),
]);

export const insertPartCategorySchema = createInsertSchema(partCategories).omit({
  id: true,
  createdAt: true,
});

// `partId` vient de l'URL (/parts/:id/...) : omis, donc ignoré s'il figure dans le corps.
export const insertPartSpecificationSchema = createInsertSchema(partSpecifications)
  .omit({ id: true, createdAt: true, partId: true })
  .extend({
    specificationName: z.string().trim().min(1, "Le nom de la spécification est obligatoire."),
    specificationValue: z.string().trim().min(1, "La valeur de la spécification est obligatoire."),
    // Champ vide = pas d'unité : "" devient null (le client envoie "" quand la case est vidée).
    unit: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().nullish(),
    ),
  });

export const updatePartSpecificationSchema = insertPartSpecificationSchema.partial();

// Supplément de prix : nombre positif ou nul (numeric(10,2)), accepté en nombre ou en chaîne, stocké en chaîne.
const additionalPriceSchema = z.preprocess(
  (value) => (typeof value === "number" && Number.isFinite(value) ? String(value) : value),
  z
    .string({ invalid_type_error: "Le supplément de prix doit être un nombre positif ou nul." })
    .trim()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, "Le supplément de prix doit être un nombre positif ou nul."),
);

export const insertPartVariantSchema = createInsertSchema(partVariants)
  .omit({ id: true, createdAt: true, partId: true })
  .extend({
    variantName: z.string().trim().min(1, "Le nom de la variante est obligatoire."),
    variantCode: z.string().trim().min(1, "Le code de la variante est obligatoire."),
    additionalPrice: additionalPriceSchema.optional().default("0"),
  });

export const updatePartVariantSchema = insertPartVariantSchema.partial();

// Type exports pour les nouvelles tables
export type PartCategory = typeof partCategories.$inferSelect;
export type InsertPartCategory = z.infer<typeof insertPartCategorySchema>;

export type PartSpecification = typeof partSpecifications.$inferSelect;
export type InsertPartSpecification = z.infer<typeof insertPartSpecificationSchema>;

export type UpdatePartSpecification = z.infer<typeof updatePartSpecificationSchema>;

export type PartVariant = typeof partVariants.$inferSelect;
export type InsertPartVariant = z.infer<typeof insertPartVariantSchema>;
export type UpdatePartVariant = z.infer<typeof updatePartVariantSchema>;

// Type exports
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Vehicle = typeof vehicles.$inferSelect;
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;

export type MaintenanceSchedule = typeof maintenanceSchedules.$inferSelect;
export type InsertMaintenanceSchedule = z.infer<typeof insertMaintenanceScheduleSchema>;

export type WorkOrder = typeof workOrders.$inferSelect;
export type InsertWorkOrder = z.infer<typeof insertWorkOrderSchema>;

export type LaborCatalog = typeof laborCatalog.$inferSelect;
export type InsertLaborCatalog = z.infer<typeof insertLaborCatalogSchema>;

export type WorkOrderItem = typeof workOrderItems.$inferSelect;
export type InsertWorkOrderItem = z.infer<typeof insertWorkOrderItemSchema>;

export type Part = typeof parts.$inferSelect;
export type InsertPart = z.infer<typeof insertPartSchema>;

export type PartUsed = typeof partsUsed.$inferSelect;
export type InsertPartUsed = z.infer<typeof insertPartUsedSchema>;

export type FuelRecord = typeof fuelRecords.$inferSelect;
export type InsertFuelRecord = z.infer<typeof insertFuelRecordSchema>;

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = z.infer<typeof insertAlertSchema>;

export type PartRequirement = typeof partRequirements.$inferSelect;
export type InsertPartRequirement = z.infer<typeof insertPartRequirementSchema>;

export type VehicleDocument = typeof vehicleDocuments.$inferSelect;
export type InsertVehicleDocument = z.infer<typeof insertVehicleDocumentSchema>;

export type DocumentRenewalCenter = typeof documentRenewalCenters.$inferSelect;
export type InsertDocumentRenewalCenter = z.infer<typeof insertDocumentRenewalCenterSchema>;

export type DocumentRenewalRequest = typeof documentRenewalRequests.$inferSelect;
export type InsertDocumentRenewalRequest = z.infer<typeof insertDocumentRenewalRequestSchema>;

// Table d'historique des statuts de véhicules
export const statusHistory = pgTable("status_history", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["operational", "maintenance", "out_of_service"] }).notNull(),
  date: date("date").notNull(),
  notes: text("notes"),
  updatedById: integer("updated_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertStatusHistorySchema = createInsertSchema(statusHistory).omit({
  id: true,
  createdAt: true,
});

export type StatusHistory = typeof statusHistory.$inferSelect;
export type InsertStatusHistory = z.infer<typeof insertStatusHistorySchema>;

// Catalogue de pannes
export const faultCatalog = pgTable("fault_catalog", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(), // Moteur, Freins, Électrique, etc.
  vehicleBrand: text("vehicle_brand"), // Optionnel: spécifique à une marque
  symptoms: text("symptoms").array(), // Symptômes de la panne
  diagnosticSteps: text("diagnostic_steps").array(), // Étapes de diagnostic
  repairSteps: text("repair_steps").array(), // Étapes de réparation
  estimatedDuration: integer("estimated_duration"), // En heures
  minimumCost: real("minimum_cost"), // Coût minimum en F CFA
  maximumCost: real("maximum_cost"), // Coût maximum en F CFA
  createdBy: integer("created_by").references(() => users.id),
  validatedBy: integer("validated_by").references(() => users.id),
  status: text("status", { enum: ["draft", "validated", "archived"] }).notNull().default("draft"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertFaultCatalogSchema = createInsertSchema(faultCatalog).omit({
  id: true,
  validatedBy: true,
  createdAt: true,
  updatedAt: true,
});

// Pièces souvent utilisées pour chaque type de panne
export const faultCatalogParts = pgTable("fault_catalog_parts", {
  id: serial("id").primaryKey(),
  faultCatalogId: integer("fault_catalog_id").references(() => faultCatalog.id, { onDelete: "cascade" }).notNull(),
  partId: integer("part_id").references(() => parts.id, { onDelete: "restrict" }).notNull(),
  quantity: integer("quantity").default(1),
  isOptional: boolean("is_optional").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("ux_fault_catalog_parts_fault_part").on(table.faultCatalogId, table.partId),
  index("idx_fault_catalog_parts_part_id").on(table.partId),
]);

// `faultCatalogId` vient de l'URL (/fault-catalog/:id/parts) : omis, donc ignoré s'il figure dans le corps.
const faultPartQuantitySchema = z
  .number({ invalid_type_error: "La quantité doit être un entier d'au moins 1." })
  .int("La quantité doit être un entier d'au moins 1.")
  .min(1, "La quantité doit être un entier d'au moins 1.");
const faultPartOptionalSchema = z.boolean({ invalid_type_error: "Le caractère optionnel doit être vrai ou faux." });

export const insertFaultCatalogPartSchema = createInsertSchema(faultCatalogParts)
  .omit({ id: true, createdAt: true, faultCatalogId: true })
  .extend({
    partId: z.number({ invalid_type_error: "La pièce est obligatoire." }).int("La pièce est invalide.").positive("La pièce est invalide."),
    quantity: faultPartQuantitySchema.optional().default(1),
    isOptional: faultPartOptionalSchema.optional().default(false),
  });

// La pièce d'un lien n'est pas modifiable : supprimer puis recréer.
export const updateFaultCatalogPartSchema = z.object({
  quantity: faultPartQuantitySchema.optional(),
  isOptional: faultPartOptionalSchema.optional(),
});

export type FaultCatalog = typeof faultCatalog.$inferSelect;
export type InsertFaultCatalog = z.infer<typeof insertFaultCatalogSchema>;

export type FaultCatalogPart = typeof faultCatalogParts.$inferSelect;
export type InsertFaultCatalogPart = z.infer<typeof insertFaultCatalogPartSchema>;
export type UpdateFaultCatalogPart = z.infer<typeof updateFaultCatalogPartSchema>;

// ===== MODULE LOGS D'ACTIVITÉ =====

// Table pour enregistrer tous les logs d'activité du système
export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id), // Utilisateur qui a effectué l'action
  action: text("action").notNull(), // Type d'action (CREATE, UPDATE, DELETE, etc.)
  entityType: text("entity_type").notNull(), // Type d'entité concernée (tire, vehicle, etc.)
  entityId: integer("entity_id"), // ID de l'entité concernée
  details: jsonb("details"), // Détails de l'action en JSON
  ipAddress: text("ip_address"), // Adresse IP de l'utilisateur
  userAgent: text("user_agent"), // User agent du navigateur
  method: text("method"), // Méthode HTTP de la requête auditée (P-04)
  path: text("path"), // Chemin de la requête auditée (P-04)
  entityRef: text("entity_ref"), // Identifiant non numérique de l'entité (clé d'anomalie, code...)
  createdAt: timestamp("created_at").defaultNow().notNull()
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  createdAt: true,
});

export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;

// ===== MODULE SUIVI DES PNEUS =====

// Table principale pour l'inventaire des pneus
export const tires = pgTable("tires", {
  id: serial("id").primaryKey(),
  brand: text("brand").notNull(), // Marque (Michelin, Bridgestone, etc.)
  model: text("model").notNull(), // Modèle du pneu
  size: text("size").notNull(), // Taille (ex: 315/80R22.5)
  tireType: text("tire_type", { 
    enum: ["steer", "drive", "trailer", "all_season", "winter", "summer"] 
  }).notNull().default("drive"), // Type d'usage
  dotCode: text("dot_code"), // Code DOT pour la date de fabrication
  manufactureDate: date("manufacture_date"), // Date de fabrication
  supplier: text("supplier"), // Fournisseur
  purchasePrice: numeric("purchase_price", { precision: 10, scale: 2 }), // Prix d'achat
  warrantyMonths: integer("warranty_months"), // Garantie en mois
  maxLoadIndex: integer("max_load_index"), // Indice de charge
  speedRating: text("speed_rating"), // Indice de vitesse
  stockQuantity: integer("stock_quantity").notNull().default(0), // Quantité en stock (neuf)
  // Pneus démontés remis en stock : ils ont roulé, comptés à part, non valorisés.
  usedStockQuantity: integer("used_stock_quantity").notNull().default(0),
  minStockLevel: integer("min_stock_level").notNull().default(2), // Seuil d'alerte
  location: text("location"), // Emplacement de stockage
  notes: text("notes"), // Notes additionnelles
  createdBy: integer("created_by").references(() => users.id), // Créateur de la fiche pneu
  updatedBy: integer("updated_by").references(() => users.id), // Dernier modificateur
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at") // Soft delete
});

// Table pour suivre les pneus montés sur les véhicules
export const vehicleTires = pgTable("vehicle_tires", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").references(() => vehicles.id).notNull(),
  tireId: integer("tire_id").references(() => tires.id).notNull(),
  position: text("position", { 
    enum: ["front_left", "front_right", "rear_left_outer", "rear_left_inner", 
           "rear_right_outer", "rear_right_inner", "spare"] 
  }).notNull(), // Position sur le véhicule
  installationDate: date("installation_date").notNull(), // Date de montage
  installationMileage: integer("installation_mileage").notNull(), // Kilométrage au montage
  currentTreadDepth: real("current_tread_depth"), // Profondeur actuelle des sculptures (mm)
  initialTreadDepth: real("initial_tread_depth"), // Profondeur initiale (mm)
  currentPressure: real("current_pressure"), // Pression actuelle (bars)
  recommendedPressure: real("recommended_pressure"), // Pression recommandée (bars)
  status: text("status", { 
    enum: ["active", "removed", "punctured", "worn", "damaged"] 
  }).notNull().default("active"),
  removalDate: date("removal_date"), // Date de démontage
  removalMileage: integer("removal_mileage"), // Kilométrage au démontage
  removalReason: text("removal_reason"), // Raison du démontage
  // Stock d'où vient le pneu monté (shared/constants/tire-stock.ts).
  stockSource: text("stock_source", { enum: ["new", "used"] }).notNull().default("new"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Table pour l'historique des inspections des pneus
export const tireInspections = pgTable("tire_inspections", {
  id: serial("id").primaryKey(),
  vehicleTireId: integer("vehicle_tire_id").references(() => vehicleTires.id).notNull(),
  inspectionDate: date("inspection_date").notNull(),
  inspectionMileage: integer("inspection_mileage").notNull(),
  treadDepth: real("tread_depth"), // Profondeur mesurée (mm)
  pressure: real("pressure"), // Pression mesurée (bars)
  wearPattern: text("wear_pattern", { 
    enum: ["normal", "center_wear", "edge_wear", "irregular", "cupping"] 
  }), // Type d'usure
  condition: text("condition", { 
    enum: ["excellent", "good", "fair", "poor", "critical"] 
  }).notNull(),
  hasDefects: boolean("has_defects").default(false),
  defectDescription: text("defect_description"), // Description des défauts
  recommendedAction: text("recommended_action", { 
    enum: ["continue", "monitor", "rotate", "repair", "replace"] 
  }),
  inspectedBy: integer("inspected_by").references(() => users.id),
  nextInspectionDate: date("next_inspection_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull()
});

// Table pour l'historique des rotations de pneus
export const tireRotations = pgTable("tire_rotations", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").references(() => vehicles.id).notNull(),
  workOrderId: integer("work_order_id").references(() => workOrders.id), // Liaison avec les ordres de travail
  rotationDate: date("rotation_date").notNull(),
  rotationMileage: integer("rotation_mileage").notNull(),
  rotationType: text("rotation_type", { 
    enum: ["front_to_back", "cross_rotation", "rearward_cross", "forward_cross"] 
  }).notNull(),
  performedBy: integer("performed_by").references(() => users.id),
  cost: numeric("cost", { precision: 10, scale: 2 }),
  nextRotationMileage: integer("next_rotation_mileage"),
  notes: text("notes"),
  createdBy: text("created_by").notNull().default("Admin"),
  createdAt: timestamp("created_at").defaultNow().notNull()
});

// Table pour les détails de chaque rotation (quel pneu va où)
export const tireRotationDetails = pgTable("tire_rotation_details", {
  id: serial("id").primaryKey(),
  rotationId: integer("rotation_id").references(() => tireRotations.id).notNull(),
  vehicleTireId: integer("vehicle_tire_id").references(() => vehicleTires.id).notNull(),
  fromPosition: text("from_position").notNull(), // Position d'origine
  toPosition: text("to_position").notNull(), // Nouvelle position
  createdAt: timestamp("created_at").defaultNow().notNull()
});

// Schémas Zod pour validation
export const insertTireSchema = createInsertSchema(tires, {
  usedStockQuantity: (schema) => schema.int().min(0, "La quantité usagée doit être positive"),
}).omit({
  id: true,
  createdBy: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true
});

export const insertVehicleTireSchema = createInsertSchema(vehicleTires).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertTireInspectionSchema = createInsertSchema(tireInspections).omit({
  id: true,
  createdAt: true
});

export const insertTireRotationSchema = createInsertSchema(tireRotations).omit({
  id: true,
  createdAt: true
});

export const insertTireRotationDetailSchema = createInsertSchema(tireRotationDetails).omit({
  id: true,
  createdAt: true
});

// Types TypeScript
export type Tire = typeof tires.$inferSelect;
export type InsertTire = z.infer<typeof insertTireSchema>;

export type VehicleTire = typeof vehicleTires.$inferSelect;
export type InsertVehicleTire = z.infer<typeof insertVehicleTireSchema>;

export type TireInspection = typeof tireInspections.$inferSelect;
export type InsertTireInspection = z.infer<typeof insertTireInspectionSchema>;

export type TireRotation = typeof tireRotations.$inferSelect;
export type InsertTireRotation = z.infer<typeof insertTireRotationSchema>;

export type TireRotationDetail = typeof tireRotationDetails.$inferSelect;
export type InsertTireRotationDetail = z.infer<typeof insertTireRotationDetailSchema>;

// Schema et types pour les workflows d'acquisition
export const insertVehicleAcquisitionWorkflowSchema = createInsertSchema(vehicleAcquisitionWorkflows).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type VehicleAcquisitionWorkflow = typeof vehicleAcquisitionWorkflows.$inferSelect;
export type InsertVehicleAcquisitionWorkflow = z.infer<typeof insertVehicleAcquisitionWorkflowSchema>;

// ===== NOUVELLES TABLES PHASE 1 - CORRESPONDANCE EXCEL =====

// Table drivers - Gestion personnel et CPC (correspondance Excel CPC ET HABILITATION)
export const drivers = pgTable("drivers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id), // Référence vers users
  firstName: text("first_name").notNull(), // Prénom chauffeur
  lastName: text("last_name").notNull(), // Nom chauffeur
  employeeNumber: text("employee_number").unique(), // N° Excel - numéro employé
  birthDate: date("birth_date"), // DATE NAISSANCE Excel
  cniNumber: text("cni_number"), // CNI Excel - numéro carte identité
  cniExpiry: date("cni_expiry"), // VALIDITÉ CNI Excel
  licenseNumber: text("license_number"), // N° PERMIS Excel
  licenseExpiry: date("license_expiry"), // VALIDITÉ PERMIS Excel
  hireDate: date("hire_date"), // Date d'embauche
  geoTrainingDate: date("geo_training_date"), // FORMATION GEO Excel
  cpcTrainingDate: date("cpc_training_date"), // DATE FORMATION CPC Excel
  cpcStatus: text("cpc_status"), // STATUT calculé Excel (FORMÉ/À FORMER/NON FORMÉ)
  cpcStatusUpdatedAt: timestamp("cpc_status_updated_at"), // Dernière mise à jour statut
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  // #113 : une fiche par compte ; posé par server/init-database.ts (DRIVERS_USER_ID_UNIQUE_SQL), jamais sur doublons.
  uniqueIndex("uq_drivers_user_id").on(table.userId).where(sql`${table.userId} IS NOT NULL`),
]);

// Table suppliers - Gestion fournisseurs (12 fournisseurs Excel identifiés) - ENRICHIE PHASE 1
export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // Nom entreprise fournisseur (CFAO MOBILITY, etc.)
  contactName: text("contact_name"), // Nom personne contact
  email: text("email"), // Email contact
  phone: text("phone"), // Téléphone contact
  address: text("address"), // Adresse complète
  category: text("category"), // Assurance, Pièces, Télécom, etc.
  siret: text("siret"), // Numéro SIRET/SIREN
  vatNumber: text("vat_number"), // Numéro TVA intracommunautaire
  paymentTerms: integer("payment_terms").default(30), // Délai paiement (jours)
  deliveryTerms: text("delivery_terms"), // Conditions de livraison
  // Évaluations performance (0-5 échelle)
  qualityRating: numeric("quality_rating", { precision: 3, scale: 2 }), // Note qualité produits/services
  reliabilityRating: numeric("reliability_rating", { precision: 3, scale: 2 }), // Note fiabilité délais
  priceCompetitiveness: numeric("price_competitiveness", { precision: 3, scale: 2 }), // Note compétitivité prix
  notes: text("notes"), // Notes supplémentaires
  isActive: boolean("is_active").default(true),
  createdBy: integer("created_by").references(() => users.id), // Créateur de la fiche fournisseur
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Table supplierInvoices - Factures fournisseurs avec TVA 19.25% et workflow de contrôle 3 voies
export const supplierInvoices = pgTable("supplier_invoices", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrders.id), // Lien vers commande d'achat
  invoiceNumber: text("invoice_number").notNull().unique(), // Numéro facture unique
  invoiceDate: date("invoice_date").notNull(),
  dueDate: date("due_date"), // Date d'échéance de paiement
  family: text("family"), // FAMILLE Excel - catégorie produit/service
  description: text("description"), // LIBELLÉ Excel - description détaillée
  quantity: numeric("quantity", { precision: 10, scale: 2 }), // QTÉ Excel - quantité numérique
  
  // Montants et TVA
  subtotal: numeric("subtotal", { precision: 15, scale: 2 }), // Sous-total avant TVA (alias amountHT)
  amountHT: numeric("amount_ht", { precision: 15, scale: 2 }).notNull(), // MONTANT Excel HT
  taxAmount: numeric("tax_amount", { precision: 15, scale: 2 }), // Montant TVA (alias vatAmount)
  vatAmount: numeric("vat_amount", { precision: 15, scale: 2 }), // TVA calculée 19.25%
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }), // Total TTC (alias totalTTC)
  totalTTC: numeric("total_ttc", { precision: 15, scale: 2 }), // PAIEMENT Excel TTC
  balance: numeric("balance", { precision: 15, scale: 2 }).default("0"), // SOLDE Excel restant
  
  // Workflow de validation (contrôle 3 voies)
  status: text("status", {
    enum: ["received", "validated", "approved", "paid", "disputed"]
  }).notNull().default("received"), // Statut workflow
  
  // Traçabilité validation
  validatedBy: integer("validated_by").references(() => users.id), // Validateur technique
  validatedAt: timestamp("validated_at"), // Date validation
  approvedBy: integer("approved_by").references(() => users.id), // Approbateur
  approvedAt: timestamp("approved_at"), // Date approbation
  paidBy: integer("paid_by").references(() => users.id), // Qui a enregistré le paiement
  paidDate: date("paid_date"), // Date paiement effectif (alias paymentDate)
  
  // Contrôle 3 voies - Écarts détectés
  priceVariance: numeric("price_variance", { precision: 15, scale: 2 }).default("0"), // Écart de prix vs commande
  quantityVariance: numeric("quantity_variance", { precision: 10, scale: 2 }).default("0"), // Écart de quantité
  variancePercentage: numeric("variance_percentage", { precision: 5, scale: 2 }).default("0"), // % écart total
  hasDiscrepancy: boolean("has_discrepancy").default(false), // Indicateur d'écart >5%
  discrepancyNotes: text("discrepancy_notes"), // Notes sur les écarts
  
  // Paiement (champs existants)
  paymentDate: date("payment_date"), // Date paiement effectif
  paymentMethod: text("payment_method"), // MODE DE PAIEMENT Excel
  isPaymentComplete: boolean("is_payment_complete").default(false),
  
  // Métadonnées
  notes: text("notes"), // Notes générales
  attachmentPath: text("attachment_path"), // Chemin vers PDF facture
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Table supplierInvoiceSettlements - Règlements fournisseurs (preuve + rapprochement bancaire)
export const supplierInvoiceSettlements = pgTable("supplier_invoice_settlements", {
  id: serial("id").primaryKey(),
  supplierInvoiceId: integer("supplier_invoice_id").notNull().references(() => supplierInvoices.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  paymentMethod: text("payment_method", { enum: ["virement", "cheque", "especes", "mobile", "autre"] }).notNull(),
  paymentReference: text("payment_reference").notNull(), // Référence bancaire/chèque/MM
  paymentDate: date("payment_date").notNull(),
  valueDate: date("value_date"), // Date de valeur (optionnel)
  treasuryAccount: text("treasury_account"), // Compte/caisse de sortie
  proofReference: text("proof_reference"), // URL/ID justificatif externe
  status: text("status", { enum: ["recorded", "reconciled", "rejected"] }).notNull().default("recorded"),
  recordedBy: integer("recorded_by").references(() => users.id),
  reconciledBy: integer("reconciled_by").references(() => users.id),
  reconciledAt: timestamp("reconciled_at"),
  reconciliationNote: text("reconciliation_note"),
  // Rejet (SINV1) : seul un règlement saisi se rejette, avec un motif obligatoire.
  rejectedBy: integer("rejected_by").references(() => users.id),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Table timeTracking - Pointage personnel avec codes Excel (JT, M, Mi, C, A, R, Re)
export const timeTracking = pgTable("time_tracking", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  date: date("date").notNull(),
  status: text("status").notNull(), // Codes Excel: JT, M, Mi, C, A, R, Re
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  notes: text("notes"), // Notes optionnelles
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Table monthlyTimeStats - Statistiques pointage calculées (correspondance Excel formules NB.SI)
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

// Schémas Zod pour validation des nouvelles tables
export const insertDriverSchema = createInsertSchema(drivers).omit({
  id: true,
  createdAt: true,
});

export const insertSupplierSchema = createInsertSchema(suppliers).omit({
  id: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSupplierInvoiceSchema = createInsertSchema(supplierInvoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  invoiceDate: z.string().transform((val) => val),
  dueDate: z.string().optional().transform((val) => val ? val : undefined),
  paidDate: z.string().optional().transform((val) => val ? val : undefined),
  paymentDate: z.string().optional().transform((val) => val ? val : undefined),
  amountHT: z.union([z.string(), z.number()]).transform((val) => String(val)),
  subtotal: z.union([z.string(), z.number()]).optional().transform((val) => val !== undefined ? String(val) : undefined),
  taxAmount: z.union([z.string(), z.number()]).optional().transform((val) => val !== undefined ? String(val) : undefined),
  vatAmount: z.union([z.string(), z.number()]).optional().transform((val) => val !== undefined ? String(val) : undefined),
  totalAmount: z.union([z.string(), z.number()]).optional().transform((val) => val !== undefined ? String(val) : undefined),
  totalTTC: z.union([z.string(), z.number()]).optional().transform((val) => val !== undefined ? String(val) : undefined),
});

export const insertSupplierInvoiceSettlementSchema = createInsertSchema(supplierInvoiceSettlements).omit({
  id: true,
  recordedBy: true,
  reconciledBy: true,
  reconciledAt: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  amount: z.union([z.string(), z.number()]).transform((val) => String(val)),
  paymentDate: z.string().transform((val) => val),
  valueDate: z.string().optional().transform((val) => val || undefined),
});

export const insertTimeTrackingSchema = createInsertSchema(timeTracking).omit({
  id: true,
  createdAt: true,
});

export const insertMonthlyTimeStatsSchema = createInsertSchema(monthlyTimeStats).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types TypeScript pour les nouvelles tables
export type Driver = typeof drivers.$inferSelect;
export type InsertDriver = z.infer<typeof insertDriverSchema>;

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;

export type SupplierInvoice = typeof supplierInvoices.$inferSelect;
export type InsertSupplierInvoice = z.infer<typeof insertSupplierInvoiceSchema>;
export type SupplierInvoiceSettlement = typeof supplierInvoiceSettlements.$inferSelect;
export type InsertSupplierInvoiceSettlement = z.infer<typeof insertSupplierInvoiceSettlementSchema>;

export type TimeTracking = typeof timeTracking.$inferSelect;
export type InsertTimeTracking = z.infer<typeof insertTimeTrackingSchema>;

export type MonthlyTimeStats = typeof monthlyTimeStats.$inferSelect;
export type InsertMonthlyTimeStats = z.infer<typeof insertMonthlyTimeStatsSchema>;

// ===== NOUVELLES TABLES PHASE 2 - GESTION DES MISSIONS (TRANSPORT) =====

// Table clients - Gestion des clients (MAERSK, CNPCC, etc.)
export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // Nom client (MAERSK, CNPCC, etc.)
  contactPerson: text("contact_person"), // Personne contact
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  billingAddress: text("billing_address"),
  taxId: text("tax_id"), // Numéro fiscal
  paymentTerms: integer("payment_terms").default(30), // Délai paiement (jours)
  isActive: boolean("is_active").default(true),
  createdBy: integer("created_by").references(() => users.id), // Créateur de la fiche client
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Table missions - Missions de transport (livraisons, récupérations)
export const missions = pgTable("missions", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id),
  orderNumber: text("order_number").notNull().unique(), // N° commande/BL
  
  // Type et détails mission
  missionType: text("mission_type", { enum: ["delivery", "pickup", "round_trip", "other"] }).notNull().default("delivery"),
  
  // Trajet
  pickupAddress: text("pickup_address").notNull(),
  pickupDate: timestamp("pickup_date"),
  deliveryAddress: text("delivery_address").notNull(),
  deliveryDate: timestamp("delivery_date"),
  
  // Cargo
  cargo: jsonb("cargo"), // Description flexible (conteneurs, palettes, etc.)
  weight: numeric("weight", { precision: 10, scale: 2 }), // Tonnes
  volume: numeric("volume", { precision: 10, scale: 2 }), // m³
  
  // Distance et coûts
  estimatedDistance: integer("estimated_distance"), // km
  actualDistance: integer("actual_distance"), // km réel
  estimatedFuelCost: numeric("estimated_fuel_cost", { precision: 15, scale: 2 }),
  actualFuelCost: numeric("actual_fuel_cost", { precision: 15, scale: 2 }),
  actualFuelQuantity: real("actual_fuel_quantity"), // Litres consommés
  
  // Instructions
  specialInstructions: text("special_instructions"),
  
  // Statut workflow
  status: text("status", { 
    enum: ["draft", "planned", "assigned", "in_progress", "delivered", "completed", "cancelled"] 
  }).notNull().default("draft"),
  currentStep: integer("current_step").default(1), // Étape workflow (1-4)
  
  // POD (Proof of Delivery)
  podUrl: text("pod_url"), // URL document POD
  podUploadedAt: timestamp("pod_uploaded_at"),
  
  // Validation
  validatedBy: integer("validated_by").references(() => users.id),
  validatedAt: timestamp("validated_at"),
  
  // Workflow data (sauvegarde état formulaire)
  workflowData: jsonb("workflow_data"),
  sessionId: text("session_id"), // ID session workflow
  
  // Métadonnées
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancellationReason: text("cancellation_reason"),
});

// Table assignments - Affectation véhicule + chauffeur à une mission
export const assignments = pgTable("assignments", {
  id: serial("id").primaryKey(),
  missionId: integer("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  driverId: integer("driver_id").references(() => drivers.id),
  
  // Dates affectation
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  acceptedAt: timestamp("accepted_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  
  // Statut
  status: text("status", { 
    enum: ["pending", "accepted", "rejected", "in_progress", "completed", "cancelled"] 
  }).notNull().default("pending"),
  
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Table missionSteps - Étapes d'une mission (pickup, delivery, rest, refuel)
export const missionSteps = pgTable("mission_steps", {
  id: serial("id").primaryKey(),
  missionId: integer("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
  
  stepType: text("step_type", { 
    enum: ["pickup", "delivery", "rest", "refuel", "checkpoint"] 
  }).notNull(),
  stepNumber: integer("step_number").notNull(), // Ordre étape
  
  location: text("location").notNull(),
  plannedTime: timestamp("planned_time"),
  actualTime: timestamp("actual_time"),
  
  notes: text("notes"),
  proofOfDelivery: text("proof_of_delivery"), // URL POD si applicable
  
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Table clientInvoices - Factures clients (Sprint 4)
export const clientInvoices = pgTable("client_invoices", {
  id: serial("id").primaryKey(),
  missionId: integer("mission_id").references(() => missions.id),
  clientId: integer("client_id").references(() => clients.id),
  
  // Informations facture
  invoiceNumber: text("invoice_number").notNull().unique(),
  invoiceDate: date("invoice_date").notNull(),
  dueDate: date("due_date").notNull(),
  
  // Montants
  amountHT: numeric("amount_ht", { precision: 15, scale: 2 }).notNull(), // Hors taxe
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).default("19.25"), // TVA 19.25%
  vatAmount: numeric("vat_amount", { precision: 15, scale: 2 }).default("0"),
  amountTTC: numeric("amount_ttc", { precision: 15, scale: 2 }).notNull(), // TTC
  
  // Paiement
  balance: numeric("balance", { precision: 15, scale: 2 }).notNull(), // Solde restant
  status: text("status", { enum: ["pending", "partial", "paid", "overdue", "cancelled"] }).notNull().default("pending"),
  
  // Items facture (détails lignes)
  items: jsonb("items"), // [{description, quantity, unitPrice, total}]
  
  // Notes
  notes: text("notes"),
  termsAndConditions: text("terms_and_conditions"),
  
  // Métadonnées
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Table clientPayments - Paiements clients (Sprint 4)
export const clientPayments = pgTable("client_payments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => clientInvoices.id, { onDelete: "cascade" }),
  
  // Détails paiement
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  paymentDate: date("payment_date").notNull(),
  paymentMethod: text("payment_method", { enum: ["cash", "bank_transfer", "check", "mobile_money", "other"] }).notNull(),
  reference: text("reference"), // N° chèque, référence virement, etc.
  
  // Notes
  notes: text("notes"),
  
  // Métadonnées
  recordedBy: integer("recorded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Relations pour les missions et assignments
export const missionsRelations = relations(missions, ({ one, many }) => ({
  assignment: one(assignments, {
    fields: [missions.id],
    references: [assignments.missionId],
  }),
  client: one(clients, {
    fields: [missions.clientId],
    references: [clients.id],
  }),
  fuelRecords: many(fuelRecords),
}));

export const assignmentsRelations = relations(assignments, ({ one }) => ({
  mission: one(missions, {
    fields: [assignments.missionId],
    references: [missions.id],
  }),
  vehicle: one(vehicles, {
    fields: [assignments.vehicleId],
    references: [vehicles.id],
  }),
  driver: one(drivers, {
    fields: [assignments.driverId],
    references: [drivers.id],
  }),
}));

export const driversRelations = relations(drivers, ({ many }) => ({
  assignments: many(assignments),
}));

export const vehiclesRelations = relations(vehicles, ({ many }) => ({
  assignments: many(assignments),
}));

export const clientsRelations = relations(clients, ({ many }) => ({
  missions: many(missions),
}));

export const fuelRecordsRelations = relations(fuelRecords, ({ one }) => ({
  vehicle: one(vehicles, {
    fields: [fuelRecords.vehicleId],
    references: [vehicles.id],
  }),
  mission: one(missions, {
    fields: [fuelRecords.missionId],
    references: [missions.id],
  }),
  createdByUser: one(users, {
    fields: [fuelRecords.createdBy],
    references: [users.id],
  }),
  updatedByUser: one(users, {
    fields: [fuelRecords.updatedBy],
    references: [users.id],
  }),
}));

// Schémas Zod pour validation
export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMissionSchema = createInsertSchema(missions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  cancelledAt: true,
}).extend({
  pickupDate: z.string().optional().transform((val) => val ? new Date(val) : undefined),
  deliveryDate: z.string().optional().transform((val) => val ? new Date(val) : undefined),
  weight: z.union([z.string(), z.number()]).optional().nullable().transform((val) => val !== null && val !== undefined ? String(val) : null),
  volume: z.union([z.string(), z.number()]).optional().nullable().transform((val) => val !== null && val !== undefined ? String(val) : null),
});

export const insertAssignmentSchema = createInsertSchema(assignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  assignedAt: true,
});

export const insertMissionStepSchema = createInsertSchema(missionSteps).omit({
  id: true,
  createdAt: true,
}).extend({
  plannedTime: z.string().optional().transform((val) => val ? new Date(val) : undefined),
  actualTime: z.string().optional().transform((val) => val ? new Date(val) : undefined),
});

export const insertClientInvoiceSchema = createInsertSchema(clientInvoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  invoiceDate: z.string().transform((val) => val),
  dueDate: z.string().transform((val) => val),
  amountHT: z.union([z.string(), z.number()]).transform((val) => String(val)),
  vatAmount: z.union([z.string(), z.number()]).optional().transform((val) => val !== undefined ? String(val) : "0"),
  amountTTC: z.union([z.string(), z.number()]).transform((val) => String(val)),
  balance: z.union([z.string(), z.number()]).transform((val) => String(val)),
});

export const insertClientPaymentSchema = createInsertSchema(clientPayments).omit({
  id: true,
  createdAt: true,
}).extend({
  amount: z.union([z.string(), z.number()]).transform((val) => String(val)),
  paymentDate: z.string().transform((val) => val),
});

// Types TypeScript pour les nouvelles tables
export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;

export type Mission = typeof missions.$inferSelect;
export type InsertMission = z.infer<typeof insertMissionSchema>;

export type Assignment = typeof assignments.$inferSelect;
export type InsertAssignment = z.infer<typeof insertAssignmentSchema>;

export type MissionStep = typeof missionSteps.$inferSelect;
export type InsertMissionStep = z.infer<typeof insertMissionStepSchema>;

export type ClientInvoice = typeof clientInvoices.$inferSelect;
export type InsertClientInvoice = z.infer<typeof insertClientInvoiceSchema>;

export type ClientPayment = typeof clientPayments.$inferSelect;
export type InsertClientPayment = z.infer<typeof insertClientPaymentSchema>;

// ===== NOUVELLES TABLES PHASE 2 - SYSTÈME COMMANDES GROUPÉES (PROCUREMENT) =====

/**
 * Table purchaseOrders - Commandes d'achat groupées pour optimisation des coûts
 * Permet le regroupement automatique des demandes de pièces par fournisseur
 * Objectif : Économies de 5-10% via remises volume et optimisation temporelle
 */
export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(), // Numéro unique de commande (auto-généré)
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id), // Fournisseur de la commande
  
  // Dates et planning
  orderDate: date("order_date").notNull(), // Date création commande
  expectedDeliveryDate: date("expected_delivery_date"), // Date livraison prévue
  actualDeliveryDate: date("actual_delivery_date"), // Date livraison réelle
  deliveryCode: text("delivery_code"), // Code/numéro de bon de livraison pour traçabilité
  
  // Statuts workflow
  status: text("status", { 
    enum: ["draft", "sent", "confirmed", "cancellation_requested", "partial", "delivered", "completed", "cancelled"] 
  }).notNull().default("draft"), // Workflow de validation
  
  // Montants et coûts
  totalAmountHT: numeric("total_amount_ht", { precision: 15, scale: 2 }).default("0"), // Total HT
  vatAmount: numeric("vat_amount", { precision: 15, scale: 2 }).default("0"), // TVA 19.25%
  totalAmountTTC: numeric("total_amount_ttc", { precision: 15, scale: 2 }).default("0"), // Total TTC
  
  // Remises et optimisation
  discountPercentage: numeric("discount_percentage", { precision: 5, scale: 2 }).default("0"), // % remise volume
  discountAmount: numeric("discount_amount", { precision: 15, scale: 2 }).default("0"), // Montant remise
  
  // Workflow et validation
  createdBy: integer("created_by").references(() => users.id), // Créateur (warehouse/workshop_manager)
  approvedBy: integer("approved_by").references(() => users.id), // Validateur (admin/workshop_manager)
  approvedAt: timestamp("approved_at"), // Date validation
  
  // Informations complémentaires
  notes: text("notes"), // Notes internes
  deliveryAddress: text("delivery_address"), // Adresse livraison (si différente)
  urgency: text("urgency", { enum: ["low", "medium", "high", "critical"] }).default("medium"), // Urgence globale
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Table purchaseOrderLines - Lignes de commandes d'achat
 * Chaque ligne peut être liée à un partRequirement pour tracer l'origine de la demande
 * Permet le suivi détaillé des livraisons partielles
 */
export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  
  // Origine de la demande (traçabilité)
  partRequirementId: integer("part_requirement_id").references(() => partRequirements.id), // Lien vers besoin origine
  partId: integer("part_id").references(() => parts.id), // Pièce commandée
  
  // Quantités et livraison
  quantityOrdered: integer("quantity_ordered").notNull(), // Quantité commandée
  quantityReceived: integer("quantity_received").default(0), // Quantité reçue
  quantityAccepted: integer("quantity_accepted").default(0), // Quantité acceptée (après contrôle)
  quantityRejected: integer("quantity_rejected").default(0), // Quantité refusée
  
  // Prix et montants
  unitPrice: numeric("unit_price", { precision: 15, scale: 2 }).notNull(), // Prix unitaire
  totalPrice: numeric("total_price", { precision: 15, scale: 2 }).notNull(), // Prix total ligne
  
  // Statut livraison
  deliveryStatus: text("delivery_status", { 
    enum: ["pending", "partial", "delivered", "accepted", "rejected"] 
  }).default("pending"),
  
  // Informations complémentaires
  description: text("description"), // Description article (si pas de partId)
  reference: text("reference"), // Référence fournisseur
  notes: text("notes"), // Notes sur la ligne
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Relations Drizzle pour faciliter les requêtes
export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  supplier: one(suppliers, {
    fields: [purchaseOrders.supplierId],
    references: [suppliers.id],
  }),
  createdByUser: one(users, {
    fields: [purchaseOrders.createdBy],
    references: [users.id],
  }),
  approvedByUser: one(users, {
    fields: [purchaseOrders.approvedBy],
    references: [users.id],
  }),
  lines: many(purchaseOrderLines),
}));

export const purchaseOrderLinesRelations = relations(purchaseOrderLines, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderLines.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  partRequirement: one(partRequirements, {
    fields: [purchaseOrderLines.partRequirementId],
    references: [partRequirements.id],
  }),
  part: one(parts, {
    fields: [purchaseOrderLines.partId],
    references: [parts.id],
  }),
}));

// Relations pour supplierInvoices - Workflow de contrôle 3 voies
export const supplierInvoicesRelations = relations(supplierInvoices, ({ one, many }) => ({
  supplier: one(suppliers, {
    fields: [supplierInvoices.supplierId],
    references: [suppliers.id],
  }),
  purchaseOrder: one(purchaseOrders, {
    fields: [supplierInvoices.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  validatedByUser: one(users, {
    fields: [supplierInvoices.validatedBy],
    references: [users.id],
  }),
  approvedByUser: one(users, {
    fields: [supplierInvoices.approvedBy],
    references: [users.id],
  }),
  paidByUser: one(users, {
    fields: [supplierInvoices.paidBy],
    references: [users.id],
  }),
  settlements: many(supplierInvoiceSettlements),
}));

export const supplierInvoiceSettlementsRelations = relations(supplierInvoiceSettlements, ({ one }) => ({
  invoice: one(supplierInvoices, {
    fields: [supplierInvoiceSettlements.supplierInvoiceId],
    references: [supplierInvoices.id],
  }),
  recordedByUser: one(users, {
    fields: [supplierInvoiceSettlements.recordedBy],
    references: [users.id],
  }),
  reconciledByUser: one(users, {
    fields: [supplierInvoiceSettlements.reconciledBy],
    references: [users.id],
  }),
}));

// Schémas Zod pour validation
export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
}).extend({
  orderDate: z.string().transform((val) => val),
  expectedDeliveryDate: z.string().optional().transform((val) => val || undefined),
  actualDeliveryDate: z.string().optional().transform((val) => val || undefined),
  totalAmountHT: z.union([z.string(), z.number()]).optional().transform((val) => val ? String(val) : "0"),
  vatAmount: z.union([z.string(), z.number()]).optional().transform((val) => val ? String(val) : "0"),
  totalAmountTTC: z.union([z.string(), z.number()]).optional().transform((val) => val ? String(val) : "0"),
  discountPercentage: z.union([z.string(), z.number()]).optional().transform((val) => val ? String(val) : "0"),
  discountAmount: z.union([z.string(), z.number()]).optional().transform((val) => val ? String(val) : "0"),
});

export const insertPurchaseOrderLineSchema = createInsertSchema(purchaseOrderLines).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  unitPrice: z.union([z.string(), z.number()]).transform((val) => String(val)),
  totalPrice: z.union([z.string(), z.number()]).transform((val) => String(val)),
});

// Types TypeScript
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;

export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;
export type InsertPurchaseOrderLine = z.infer<typeof insertPurchaseOrderLineSchema>;

// === Lot recette du 2 novembre 2026 (T-07a, T-07b) ===
// Chaque table est aussi créée de façon idempotente dans server/init-database.ts et dans
// server/db/migrations/20261031_lot_recette.sql (AGENTS.md §5). Contrats : shared/contracts/*.

// Référentiel des types de document véhicule (P-05). `vehicle_documents.type` reste du texte
// libre : aucune clé étrangère, le service valide contre ce référentiel.
export const vehicleDocumentTypes = pgTable("vehicle_document_types", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  validityMonths: integer("validity_months"),
  alertDays: integer("alert_days").notNull().default(30),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

// Compteur d'échecs par nom saisi, même inconnu (P-03) : ne révèle pas l'existence du compte.
export const loginAttemptsByUsername = pgTable("login_attempts_by_username", {
  usernameNormalized: text("username_normalized").primaryKey(),
  failedCount: integer("failed_count").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  lastFailedAt: timestamp("last_failed_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Préférences de notification (P-12). Absence de ligne = in-app actif, e-mail coupé.
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.userId, table.topic] })],
);

// Destinataires des alertes générées en base (triggers), par type d'alerte : des rôles, jamais un
// user_id en dur. Créée et amorcée par server/db/triggers/fuel-alerts-triggers.sql au démarrage.
export const alertRecipientSettings = pgTable("alert_recipient_settings", {
  alertType: text("alert_type").primaryKey(),
  recipientRoles: text("recipient_roles").array().notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Exécutions de sauvegarde (P-19). Un index unique partiel garantit une seule ligne `running`.
export const backupRuns = pgTable("backup_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  status: text("status", { enum: ["running", "success", "failed"] }).notNull().default("running"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  checksum: text("checksum"),
  location: text("location"),
  errorCode: text("error_code"),
});

// Résolution des anomalies carburant (P-18). Les anomalies sont calculées : la clé
// `<règle>:<fuel_record_id>` est stable, un nouveau statut remplace l'ancien.
export const fuelAnomalyResolutions = pgTable("fuel_anomaly_resolutions", {
  id: serial("id").primaryKey(),
  anomalyKey: text("anomaly_key").notNull().unique(),
  fuelRecordId: integer("fuel_record_id").references(() => fuelRecords.id, { onDelete: "set null" }),
  status: text("status", { enum: ["open", "justified", "confirmed"] }).notNull(),
  comment: text("comment"),
  resolvedBy: integer("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at").defaultNow().notNull(),
});

// Prix du litre daté (P-19). Ligne 828 au 2000-01-01 : toute date retrouve un prix.
export const fuelPrices = pgTable("fuel_prices", {
  id: serial("id").primaryKey(),
  effectiveFrom: date("effective_from").notNull().unique(),
  pricePerLiter: numeric("price_per_liter", { precision: 15, scale: 2 }).notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Déclaration de panne (P-22).
export const incidents = pgTable("incidents", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id),
  reportedBy: integer("reported_by").notNull().references(() => users.id),
  description: text("description").notNull(),
  severity: text("severity", { enum: ["low", "medium", "high"] }).notNull().default("medium"),
  status: text("status", { enum: ["open", "in_progress", "resolved"] }).notNull().default("open"),
  workOrderId: integer("work_order_id").references(() => workOrders.id, { onDelete: "set null" }),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type VehicleDocumentTypeRow = typeof vehicleDocumentTypes.$inferSelect;
export type LoginAttemptByUsername = typeof loginAttemptsByUsername.$inferSelect;
export type NotificationPreferenceRow = typeof notificationPreferences.$inferSelect;
export type BackupRunRow = typeof backupRuns.$inferSelect;
export type FuelAnomalyResolutionRow = typeof fuelAnomalyResolutions.$inferSelect;
export type FuelPriceRow = typeof fuelPrices.$inferSelect;
export type IncidentRow = typeof incidents.$inferSelect;

// Colonnes ajoutées au-dessus de tables existantes, déclarées dans une seconde table Drizzle
// pour ne pas élargir `WorkOrder` / `PartRequirement` (types construits à la main dans
// server/storage.ts et part-requirements-service.ts, hors périmètre du lot). À fusionner dans
// `workOrders` / `partRequirements` quand ces fichiers listeront les nouveaux champs.
// Lecture et écriture : `db.select().from(workOrderQuality)`, `db.update(workOrderQuality)`.
export const workOrderQuality = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  qcStatus: text("qc_status", { enum: ["passed", "failed"] }), // P-25, posé par le serveur
  qcBy: integer("qc_by").references(() => users.id),
  qcAt: timestamp("qc_at"),
  qcReason: text("qc_reason"),
});

export const partRequirementReceipts = pgTable("part_requirements", {
  id: serial("id").primaryKey(),
  receivedBy: integer("received_by").references(() => users.id),
  receivedAt: timestamp("received_at"), // P-16 : posé dans onTransition(tx)
});

// --- Chantier CDC (écarts du cahier des charges) ------------------------------------------
// SQL : server/db/migrations/20261101_cdc_ecarts.sql et CDC_SCHEMA_STATEMENTS
// (server/init-database.ts). Index partiels posés en SQL seulement ; CHECK et UNIQUE sont
// aussi déclarés ici, sous le nom que Postgres leur donne, pour qu'un `drizzle-kit push`
// (recette des tests et de la CI) crée le même schéma que la migration.

// Taux horaire atelier daté (CDC #7). Aucune valeur semée : le taux en vigueur à une date est
// la ligne au plus grand `effective_from` inférieur ou égal à cette date.
export const workshopLaborRates = pgTable("workshop_labor_rates", {
  id: serial("id").primaryKey(),
  effectiveFrom: date("effective_from").notNull(),
  hourlyRateHt: numeric("hourly_rate_ht", { precision: 15, scale: 2 }).notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique("workshop_labor_rates_effective_from_key").on(table.effectiveFrom),
  check("workshop_labor_rates_hourly_rate_ht_check", sql`${table.hourlyRateHt} >= 0`),
]);

export const insertWorkshopLaborRateSchema = createInsertSchema(workshopLaborRates).omit({
  id: true,
  createdBy: true,
  createdAt: true,
});

export const IMPORT_BATCH_KINDS = ["vehicles", "interventions"] as const;
export const IMPORT_BATCH_STATUSES = ["applied", "failed"] as const;

// Lot d'import (CDC #9). Index unique partiel import_batches_applied_file_uidx :
// un même fichier (kind, file_sha256) n'est appliqué qu'une fois.
export const importBatches = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  kind: text("kind", { enum: IMPORT_BATCH_KINDS }).notNull(),
  fileName: text("file_name"),
  fileSha256: text("file_sha256").notNull(),
  status: text("status", { enum: IMPORT_BATCH_STATUSES }).notNull().default("applied"),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  check("import_batches_kind_check", sql`${table.kind} IN ('vehicles', 'interventions')`),
  check("import_batches_status_check", sql`${table.status} IN ('applied', 'failed')`),
]);

export const IDEMPOTENCY_KEY_STATES = ["in_progress", "completed"] as const;

// Clés d'idempotence des écritures (CDC #10), écrites par le serveur seulement.
// Unicité (user_id, key) ; purge sur `expires_at` (index idempotency_keys_expires_at_idx).
export const idempotencyKeys = pgTable("idempotency_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  requestHash: text("request_hash").notNull(),
  state: text("state", { enum: IDEMPOTENCY_KEY_STATES }).notNull().default("in_progress"),
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`(now() + interval '7 days')`),
}, (table) => [
  unique("idempotency_keys_user_id_key_key").on(table.userId, table.key),
  check("idempotency_keys_state_check", sql`${table.state} IN ('in_progress', 'completed')`),
]);

// Colonnes CDC ajoutées à work_orders et vehicles, déclarées à part comme `workOrderQuality` :
// `WorkOrder` est construit à la main dans server/storage.ts, et ces colonnes ne doivent pas
// entrer dans `insertWorkOrderSchema` / `insertVehicleSchema` (écrites par le serveur).
// `origin` : NULL = saisie dans l'application, 'history_import' = reprise d'historique.
export const WORK_ORDER_ORIGINS = ["history_import"] as const;

export const workOrderPlanning = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  dueDate: date("due_date"), // CDC #7, index partiel work_orders_preventive_due_idx
  dueMileage: integer("due_mileage"), // CHECK work_orders_due_mileage_check, posé en SQL (work_orders est déclarée deux fois)
  origin: text("origin", { enum: WORK_ORDER_ORIGINS }),
  externalRef: text("external_ref"), // unique si non nul (work_orders_external_ref_uidx)
  importFingerprint: text("import_fingerprint"), // unique si non nul (work_orders_import_fingerprint_uidx)
  importBatchId: integer("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
});

export const vehicleImports = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  importBatchId: integer("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
});

export type WorkshopLaborRateRow = typeof workshopLaborRates.$inferSelect;
export type InsertWorkshopLaborRate = z.infer<typeof insertWorkshopLaborRateSchema>;
export type ImportBatchRow = typeof importBatches.$inferSelect;
export type NewImportBatch = typeof importBatches.$inferInsert;
export type ImportBatchKind = (typeof IMPORT_BATCH_KINDS)[number];
export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
export type WorkOrderPlanningRow = typeof workOrderPlanning.$inferSelect;
export type VehicleImportRow = typeof vehicleImports.$inferSelect;
