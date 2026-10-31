import express, { type Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import multer from "multer";
import { uploadVehicleDocument, deleteFile } from "./middleware/upload";
import { storage } from "./storage";
import { partsService } from "./services/parts-service";
import { tiresService } from "./services/tires-service-simplified";
import { FuelService } from "./services/fuel-service";
import { mileageService } from "./services/mileage-service";
import { vehicleStatusService } from "./services/vehicle-status-service";
import { stockAlertsService } from "./services/stock-alerts-service";
import { preventiveMaintenanceService } from "./services/preventive-maintenance-service";
import { activityLogger } from "./services/activity-logger";
import { TechnicianWorkOrdersService } from "./services/technician-work-orders-service";
import { authenticate, normalizeRole, isAdmin, isWorkshopManager, isTechnician, isInventoryManager, isPartsCatalogManager, isTireCatalogManager, isFuelCardManager, isFuelRecordWriter, isAnyUser } from "./middleware/auth";
import { sessionMiddleware } from "./middleware/session";
// Note: apiRouter will be imported dynamically AFTER session middleware is configured
import { 
  insertUserSchema, insertVehicleSchema, insertMaintenanceScheduleSchema, 
  insertWorkOrderSchema, insertPartSchema, insertFuelRecordSchema,
  insertAlertSchema, insertVehicleDocumentSchema, userOnboarding,
  maintenanceSchedules, workOrders, vehicles, users, parts, fuelRecords, alerts, vehicleDocuments,
  faultCatalog, vehicleTires, insertFaultCatalogSchema
} from "@shared/schema";
import { PART_UNITS } from "@shared/constants/parts";
import { db } from "./db";
import { eq, and, gte, lte, desc, asc, sql, ilike, inArray, isNull, getTableColumns } from "drizzle-orm";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { alertService } from "./services/alert-service";
import { AppError } from "./lib/app-error";
import { canAccessOwned, ownerScopeOf, OUT_OF_SCOPE_MESSAGE } from "./lib/client-scope";
import { vehicleDocumentationService } from "./services/vehicle-documentation-service";
import { prepareColumnUpdate } from "./lib/column-validation";
import { moduleLogger } from "./lib/logger";
import { isSafePathSegment, uploadedFileCandidates } from "./lib/uploaded-file";

const log = moduleLogger("routes");

// Configuration multer pour l'upload en mémoire
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/jpg',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non supporté'));
    }
  }
});

// Créer les instances des services
const fuelService = new FuelService();

async function reconcileVehicleStatusesFromWorkOrders(updatedById?: number) {
  const activeStatuses: Array<"pending" | "in_progress" | "awaiting_parts"> = [
    "pending",
    "in_progress",
    "awaiting_parts",
  ];

  const activeWorkOrderRows = await db
    .select({ vehicleId: workOrders.vehicleId })
    .from(workOrders)
    .where(inArray(workOrders.status, activeStatuses));

  const activeVehicleIds = new Set(activeWorkOrderRows.map((row) => row.vehicleId));

  const fleet = await db
    .select({ id: vehicles.id, status: vehicles.status })
    .from(vehicles)
    .where(isNull(vehicles.deletedAt));

  let movedToOperational = 0;
  let movedToMaintenance = 0;

  for (const vehicle of fleet) {
    if (vehicle.status === "maintenance" && !activeVehicleIds.has(vehicle.id)) {
      await vehicleStatusService.updateVehicleStatus(
        vehicle.id,
        "operational",
        updatedById,
        "Synchronisation automatique: aucune OT active restante"
      );
      movedToOperational++;
      continue;
    }

    if (vehicle.status === "operational" && activeVehicleIds.has(vehicle.id)) {
      await vehicleStatusService.updateVehicleStatus(
        vehicle.id,
        "maintenance",
        updatedById,
        "Synchronisation automatique: OT active détectée"
      );
      movedToMaintenance++;
    }
  }

  return {
    movedToOperational,
    movedToMaintenance,
    totalUpdated: movedToOperational + movedToMaintenance,
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Apply session middleware to main app FIRST
  app.use(sessionMiddleware);

  // Simple health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });


  
  // Authentication Routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password, rememberMe } = req.body;
      
      console.log("Login attempt:", { username, password: password ? "[PROVIDED]" : "[MISSING]" });
      
      if (!username || !password) {
        return res.status(400).json({ message: "Nom d'utilisateur et mot de passe requis" });
      }
      
      const user = await storage.getUserByUsername(username);
      console.log("User found:", user ? `Yes (${user.username})` : "No");
      
      if (!user) {
        return res.status(401).json({ message: "Identifiants invalides" });
      }
      
      // Verify password - support both bcrypt and legacy SHA-256 with auto-migration
      let isPasswordValid = await bcrypt.compare(password, user.password);
      let needsMigration = false;
      
      // If bcrypt fails and the hash looks like SHA-256 (64 hex chars), try legacy verification
      if (!isPasswordValid && user.password.length === 64 && /^[a-f0-9]{64}$/i.test(user.password)) {
        const sha256Hash = crypto.createHash("sha256").update(password).digest("hex");
        if (sha256Hash === user.password) {
          isPasswordValid = true;
          needsMigration = true;
        }
      }
      
      console.log(`🔐 [AUTH] Tentative de connexion pour l'utilisateur: ${username}`);
      console.log(`🔐 [AUTH] Utilisateur trouvé: ${user.name} (${user.role})`);
      console.log(`🔐 [AUTH] Vérification du mot de passe: ${isPasswordValid ? '✅ Succès' : '❌ Échec'}`);
      if (needsMigration) {
        console.log(`🔐 [AUTH] Migration SHA-256 → bcrypt détectée pour l'utilisateur ${username}`);
      }
      
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Identifiants invalides" });
      }
      
      // Auto-migrate legacy SHA-256 passwords to bcrypt
      if (needsMigration) {
        const bcryptHash = await bcrypt.hash(password, 10);
        await storage.updateUser(user.id, { password: bcryptHash });
        console.log(`🔐 [AUTH] Mot de passe migré vers bcrypt pour l'utilisateur ${username}`);
      }

      const currentLoginAt = new Date();
      const currentLoginCount = Number(user.loginCount ?? 0) + 1;
      // Télémétrie de connexion: elle ne conditionne rien et ne doit pas
      // retarder l'entrée dans l'application. Sur cette liaison (~475 ms
      // d'aller-retour), l'attendre coûtait une demi-seconde à chaque login.
      // Lancée sans await; un échec se journalise sans bloquer l'utilisateur.
      void db
        .update(users)
        .set({
          lastLoginAt: currentLoginAt,
          loginCount: currentLoginCount,
        })
        .where(eq(users.id, user.id))
        .catch((lastLoginError) => {
          console.error("Update last login error:", lastLoginError);
        });
      
      // Set user session and persist it BEFORE returning response.
      // This avoids race conditions where frontend redirects before session is stored.
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((regenerateError) => {
          if (regenerateError) {
            return reject(regenerateError);
          }

          req.session.userId = user.id;
          req.session.username = user.username;
          req.session.role = user.role;

          // Rester connecté : session de 30 jours au lieu de 24h
          if (rememberMe) {
            req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
          }

          req.session.save((saveError) => {
            if (saveError) {
              return reject(saveError);
            }
            resolve();
          });
        });
      });
      
      return res.status(200).json({
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        loginCount: Number(currentLoginCount),
        lastLoginAt: currentLoginAt
      });
    } catch (error) {
      console.error("Login error:", error);
      return res.status(401).json({ message: "Erreur d'authentification, veuillez réessayer plus tard" });
    }
  });

  // POST /api/auth/pin-login - Connexion chauffeur par PIN
  app.post("/api/auth/pin-login", async (req, res) => {
    try {
      const { userId, pin } = req.body;
      if (!userId || !pin) {
        return res.status(400).json({ message: "userId et pin requis" });
      }

      const [user] = await db.select().from(users).where(eq(users.id, Number(userId))).limit(1);
      if (!user || user.deletedAt) {
        return res.status(401).json({ message: "Utilisateur introuvable" });
      }
      if (user.role !== "driver") {
        return res.status(403).json({ message: "Accès réservé aux chauffeurs" });
      }
      if (!user.pin) {
        return res.status(401).json({ message: "Aucun PIN configuré" });
      }

      const pinMatch = await bcrypt.compare(String(pin), user.pin);
      if (!pinMatch) {
        return res.status(401).json({ message: "PIN incorrect" });
      }

      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.role = user.role as any;

      await db.update(users).set({ loginCount: user.loginCount + 1, lastLoginAt: new Date() }).where(eq(users.id, user.id));

      return res.status(200).json({
        id: user.id, username: user.username, name: user.name, role: user.role, email: user.email,
      });
    } catch (error) {
      console.error("PIN login error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // GET /api/auth/drivers-list - Liste des chauffeurs avec compte actif (public, pour login)
  app.get("/api/auth/drivers-list", async (req, res) => {
    try {
      const driverUsers = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.role, "driver"), isNull(users.deletedAt)));
      return res.status(200).json(driverUsers);
    } catch (error) {
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Réservé à l'admin: le corps accepte `role`, une inscription publique
  // permettait de se créer un compte admin sans être connecté.
  app.post("/api/auth/register", isAdmin, async (req, res) => {
    try {
      const parsedUser = insertUserSchema.parse(req.body);
      
      // Check if username or email already exists
      const existingUsername = await storage.getUserByUsername(parsedUser.username);
      if (existingUsername) {
        return res.status(400).json({ message: "Nom d'utilisateur déjà utilisé" });
      }
      
      const existingEmail = await storage.getUserByEmail(parsedUser.email);
      if (existingEmail) {
        return res.status(400).json({ message: "Email déjà utilisé" });
      }
      
      // Hash password with bcrypt (consistent with login and password change)
      const hashedPassword = await bcrypt.hash(parsedUser.password, 10);
      
      const user = await storage.createUser({
        ...parsedUser,
        password: hashedPassword
      });
      
      return res.status(201).json({
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Données d'utilisateur invalides",
          errors: error.errors 
        });
      }
      
      console.error("Registration error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/auth/me", authenticate, async (req: Request, res) => {
    try {
      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Utilisateur non authentifié" });
      }

      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "Utilisateur non trouvé" });
      }
      
      return res.status(200).json({
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        loginCount: Number(user.loginCount ?? 0),
        lastLoginAt: user.lastLoginAt
      });
    } catch (error) {
      console.error("Get user error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    const userId = typeof req.session?.userId === "number" ? req.session.userId : null;
    const closeUserConnections =
      typeof (global as any).closeUserConnections === "function"
        ? ((global as any).closeUserConnections as (targetUserId: number, reason?: string) => void)
        : null;

    if (userId && closeUserConnections) {
      closeUserConnections(userId, "logout");
    }

    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ message: "Erreur serveur" });
      }
      
      res.clearCookie("connect.sid");
      return res.status(200).json({ message: "Déconnexion réussie" });
    });
  });

  // Warehouse Routes - Session-aware routes for chart data
  // These routes are placed here instead of warehouse.routes.ts to ensure proper session propagation
  
  // Pièces les plus consommées pour graphique
  app.get("/api/warehouse/top-consumed-parts", authenticate, async (req: Request, res: Response) => {
    try {
      console.log('🔐 [AUTH] GET /api/warehouse/top-consumed-parts - Session exists:', !!req.session, 'UserId:', req.session?.userId);
      const limit = parseInt(req.query.limit as string) || 10;
      const topConsumed = await stockAlertsService.getTopConsumedParts(limit);

      console.log(`📊 Top consumed parts (${topConsumed.length} items):`, topConsumed);
      return res.status(200).json(topConsumed);
    } catch (error) {
      console.error("Get top consumed parts error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Historique de la valeur du stock
  app.get("/api/warehouse/stock-value-history", authenticate, async (req: Request, res: Response) => {
    try {
      console.log('🔐 [AUTH] GET /api/warehouse/stock-value-history - Session exists:', !!req.session, 'UserId:', req.session?.userId);
      const days = parseInt(req.query.days as string) || 30;
      const history = await stockAlertsService.getStockValueHistory(days);

      console.log(`📈 Stock value history (${history.length} days):`, history.slice(0, 3));
      return res.status(200).json(history);
    } catch (error) {
      console.error("Get stock value history error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Routes pour la gestion des utilisateurs
  // Obtenir la liste des utilisateurs - Administrateurs voient tout, chefs d'atelier voient techniciens/clients uniquement
  app.get("/api/users", authenticate, async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Utilisateur non authentifié" });
      }

      const currentUser = await storage.getUser(req.session.userId);
      if (!currentUser) {
        return res.status(401).json({ message: "Utilisateur non trouvé" });
      }

      const debugUsers = process.env.USERS_DEBUG !== "0";
      if (debugUsers) {
        console.log(`👥 [USERS] Liste demandée par ${currentUser.username} (${currentUser.role})`);
      }

      const allUsers = await storage.getAllUsers();
      
      let filteredUsers = allUsers;
      
      // Si c'est un chef d'atelier, filtrer pour exclure les administrateurs
      if (currentUser.role === "workshop_manager") {
        filteredUsers = allUsers.filter(user => user.role !== "admin");
      } else if (currentUser.role !== "admin") {
        // Les autres rôles ne peuvent pas voir la liste des utilisateurs
        return res.status(403).json({ message: "Accès non autorisé" });
      }
      
      // Ne pas renvoyer les mots de passe
      const sanitizedUsers = filteredUsers.map(user => {
        const parsedLoginCount = Number(user.loginCount ?? 0);
        const normalizedLoginCount = Number.isFinite(parsedLoginCount) ? Math.max(0, Math.trunc(parsedLoginCount)) : 0;
        const effectiveLoginCount = normalizedLoginCount === 0 && user.lastLoginAt ? 1 : normalizedLoginCount;

        return {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          role: user.role,
          loginCount: effectiveLoginCount,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt
        };
      });

      if (debugUsers) {
        console.log(`👥 [USERS] ${sanitizedUsers.length} utilisateurs renvoyés`);
      }

      return res.status(200).json(sanitizedUsers);
    } catch (error) {
      console.error("Get users error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Get technicians list - accessible to authenticated users
  app.get("/api/users/technicians", authenticate, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const technicians = allUsers
        .filter(user => user.role === 'technician' || user.role === 'workshop_manager')
        .map(user => ({
          id: user.id,
          name: user.name || user.username,
          username: user.username,
          role: user.role
        }));
      
      return res.status(200).json(technicians);
    } catch (error) {
      console.error("Get technicians error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Get inventory responsibles list - utilisateurs pouvant être responsables magasin/stock
  app.get("/api/users/inventory-responsibles", authenticate, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Utilisateur non authentifié" });
      }

      const currentUser = await storage.getUser(userId);
      if (!currentUser) {
        return res.status(401).json({ message: "Utilisateur non trouvé" });
      }

      // Les clients externes n'ont pas besoin de cette liste interne
      if (currentUser.role === "client") {
        return res.status(403).json({ message: "Accès non autorisé" });
      }

      const allUsers = await db.select().from(users);

      // Responsable magasin = utilisateur de rôle magasinier
      // Inclure l'utilisateur connecté même s'il est soft-delete pour éviter une liste vide incohérente
      const responsibles = allUsers
        .filter((user) => user.role === "warehouse" && (user.deletedAt === null || user.id === currentUser.id))
        .map((user) => ({
          id: user.id,
          name: user.name,
          username: user.username,
          role: user.role,
        }))
        .sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username, "fr"));

      return res.status(200).json(responsibles);
    } catch (error) {
      console.error("Get inventory responsibles error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Ajouter un nouvel utilisateur - Réservé aux administrateurs
  app.post("/api/users", authenticate, isAdmin, async (req, res) => {
    // Jamais le corps dans les logs : il porte le mot de passe en clair.
    log.info({ requestId: req.requestId, username: req.body?.username }, "Création d'utilisateur - requête reçue");

    try {
      const parsedUser = insertUserSchema.parse(req.body);
      log.info({ requestId: req.requestId, username: parsedUser.username, role: parsedUser.role }, "Données utilisateur valides");

      // Vérifier si le nom d'utilisateur ou l'email existe déjà
      const existingUsername = await storage.getUserByUsername(parsedUser.username);
      if (existingUsername) {
        log.info({ requestId: req.requestId, username: parsedUser.username }, "Nom d'utilisateur déjà utilisé");
        return res.status(400).json({ message: "Nom d'utilisateur déjà utilisé" });
      }

      const existingEmail = await storage.getUserByEmail(parsedUser.email);
      if (existingEmail) {
        log.info({ requestId: req.requestId }, "Email déjà utilisé");
        return res.status(400).json({ message: "Email déjà utilisé" });
      }

      // Hasher le mot de passe
      const hashedPassword = await bcrypt.hash(parsedUser.password, 10);

      log.info({ requestId: req.requestId }, "Tentative de création utilisateur dans la base de données");

      try {
        const user = await storage.createUser({
          ...parsedUser,
          password: hashedPassword
        });

        log.info({ requestId: req.requestId, userId: user.id }, "Utilisateur créé avec succès");

        return res.status(201).json({
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          role: user.role
        });
      } catch (dbError) {
        log.error({ err: dbError, requestId: req.requestId }, "Erreur lors de la création de l'utilisateur dans la base");
        return res.status(500).json({ message: "Erreur lors de la création dans la base de données" });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        log.warn({ requestId: req.requestId, issues: error.issues.map((issue) => issue.path.join(".")) }, "Validation error");
        return res.status(400).json({
          message: "Données d'utilisateur invalides",
          errors: error.errors
        });
      }

      log.error({ err: error, requestId: req.requestId }, "Create user error");
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Mettre à jour un utilisateur - Réservé aux administrateurs
  app.patch("/api/users/:id", authenticate, isAdmin, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID d'utilisateur invalide" });
      }
      
      const user = await storage.getUser(id);
      
      if (!user) {
        return res.status(404).json({ message: "Utilisateur non trouvé" });
      }
      
      // Les écrans renvoient la fiche entière (id, createdAt, loginCount...) :
      // le schéma d'insertion écarte ces champs serveur et contrôle le reste.
      // Avant, createdAt en chaîne faisait échouer l'écriture, avalée en 404.
      const { password, ...rest } = req.body ?? {};
      const userData = insertUserSchema.partial().parse(rest);

      // Le stockage avale l'erreur d'unicité : la vérifier ici pour un 409 lisible.
      if (userData.username) {
        const owner = await storage.getUserByUsername(userData.username);
        if (owner && owner.id !== id) return next(new AppError(409, "Ce nom d'utilisateur est déjà utilisé."));
      }
      if (userData.email) {
        const owner = await storage.getUserByEmail(userData.email);
        if (owner && owner.id !== id) return next(new AppError(409, "Cette adresse e-mail est déjà utilisée."));
      }

      // Si le mot de passe est fourni, le hasher ; vide, il est ignoré
      if (typeof password === "string" && password.trim() !== "") {
        userData.password = await bcrypt.hash(password, 10);
      }

      if (Object.keys(userData).length === 0) {
        return next(new AppError(400, "Aucune modification à enregistrer."));
      }

      const updatedUser = await storage.updateUser(id, userData);
      
      if (!updatedUser) {
        return res.status(404).json({ message: "Utilisateur non trouvé" });
      }
      
      return res.status(200).json({
        id: updatedUser.id,
        username: updatedUser.username,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        loginCount: Number(updatedUser.loginCount ?? 0),
        createdAt: updatedUser.createdAt,
        lastLoginAt: updatedUser.lastLoginAt
      });
    } catch (error) {
      if (error instanceof z.ZodError) return next(error);
      log.error({ err: error, requestId: req.requestId }, "Update user error");
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Supprimer un utilisateur (soft delete) - Réservé aux administrateurs
  app.delete("/api/users/:id", authenticate, isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID d'utilisateur invalide" });
      }
      
      // Empêcher la suppression de l'utilisateur connecté
      if (id === req.session.userId) {
        return res.status(400).json({ message: "Vous ne pouvez pas supprimer votre propre compte" });
      }
      
      const success = await storage.deleteUser(id);
      
      if (!success) {
        return res.status(404).json({ message: "Utilisateur non trouvé ou déjà supprimé" });
      }
      
      return res.status(204).send();
    } catch (error) {
      console.error("Delete user error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // ========================================
  // Routes API Admin /api/admin/users
  // ========================================

  // GET /api/admin/users - Liste paginée des utilisateurs pour le dashboard admin
  app.get("/api/admin/users", authenticate, isAdmin, async (req, res) => {
    try {
      const search = req.query.search as string | undefined;
      const role = req.query.role as string | undefined;
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = parseInt(req.query.offset as string) || 0;
      const isUserOnline =
        typeof (global as any).isUserOnline === "function"
          ? ((global as any).isUserOnline as (userId: number) => boolean)
          : null;

      // Get ALL users including deleted ones for admin management
      const adminUserList = await db.select().from(users);
      
      // Filter by search and role
      let filteredUsers = adminUserList;
      
      if (search) {
        const searchLower = search.toLowerCase();
        filteredUsers = filteredUsers.filter(u => 
          u.username.toLowerCase().includes(searchLower) ||
          (u.name && u.name.toLowerCase().includes(searchLower)) ||
          u.email.toLowerCase().includes(searchLower)
        );
      }
      
      if (role) {
        filteredUsers = filteredUsers.filter(u => u.role === role);
      }

      const total = filteredUsers.length;
      const userList = filteredUsers.slice(offset, offset + limit).map(u => {
        const parsedLoginCount = Number(u.loginCount ?? 0);
        const normalizedLoginCount = Number.isFinite(parsedLoginCount) ? Math.max(0, Math.trunc(parsedLoginCount)) : 0;
        const effectiveLoginCount = normalizedLoginCount === 0 && u.lastLoginAt ? 1 : normalizedLoginCount;

        return {
          id: u.id,
          username: u.username,
          email: u.email,
          name: u.name,
          role: u.role,
          loginCount: effectiveLoginCount,
          createdAt: u.createdAt,
          lastLoginAt: u.lastLoginAt,
          deletedAt: u.deletedAt,
          isOnline: isUserOnline ? isUserOnline(u.id) : false,
        };
      });

      return res.status(200).json({ users: userList, total });
    } catch (error) {
      console.error("Get admin users error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // GET /api/admin/users/statistics - Statistiques pour le dashboard admin
  app.get("/api/admin/users/statistics", authenticate, isAdmin, async (req, res) => {
    try {
      // Get ALL users including deleted
      const adminUserList = await db.select().from(users);
      const activeUsers = adminUserList.filter(u => u.deletedAt === null);
      const getOnlineUserIds =
        typeof (global as any).getOnlineUserIds === "function"
          ? ((global as any).getOnlineUserIds as () => number[])
          : null;
      
      const usersByRole: Record<string, number> = {};
      activeUsers.forEach(u => {
        usersByRole[u.role] = (usersByRole[u.role] || 0) + 1;
      });

      const onlineUserIdSet = new Set<number>(getOnlineUserIds ? getOnlineUserIds() : []);
      const onlineUsers = activeUsers.filter((u) => onlineUserIdSet.has(u.id)).length;

      return res.status(200).json({
        totalUsers: adminUserList.length,
        activeUsers: activeUsers.length,
        usersByRole,
        onlineUsers,
      });
    } catch (error) {
      console.error("Get users statistics error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // PATCH /api/admin/users/:id/toggle - Activer/désactiver un utilisateur
  app.patch("/api/admin/users/:id/toggle", authenticate, isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { isActive } = req.body;

      if (isNaN(id)) {
        return res.status(400).json({ message: "ID invalide" });
      }

      // Get current user state
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: "Utilisateur non trouvé" });
      }

      // If isActive is false, soft delete (set deletedAt)
      // If isActive is true, restore (set deletedAt to null)
      const deletedAtValue = isActive ? null : new Date();
      const [updatedUser] = await db
        .update(users)
        .set({ deletedAt: deletedAtValue })
        .where(eq(users.id, id))
        .returning();

      if (!isActive && typeof (global as any).closeUserConnections === "function") {
        ((global as any).closeUserConnections as (targetUserId: number, reason?: string) => void)(
          id,
          "deactivated_by_admin",
        );
      }

      return res.status(200).json({ 
        message: isActive ? "Utilisateur activé" : "Utilisateur désactivé",
        user: updatedUser
      });
    } catch (error) {
      console.error("Toggle user error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // DELETE /api/admin/users/:id - Supprimer définitivement un utilisateur
  app.delete("/api/admin/users/:id", authenticate, isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      if (isNaN(id)) {
        return res.status(400).json({ message: "ID invalide" });
      }

      // Empêcher la suppression de l'utilisateur connecté
      if (id === req.session.userId) {
        return res.status(400).json({ message: "Vous ne pouvez pas supprimer votre propre compte" });
      }

      const success = await storage.deleteUser(id);
      
      if (!success) {
        return res.status(404).json({ message: "Utilisateur non trouvé ou déjà supprimé" });
      }

      if (typeof (global as any).closeUserConnections === "function") {
        ((global as any).closeUserConnections as (targetUserId: number, reason?: string) => void)(
          id,
          "deleted_by_admin",
        );
      }

      return res.status(204).send();
    } catch (error) {
      console.error("Delete admin user error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Récupérer un utilisateur spécifique - Administrateurs ou utilisateur lui-même
  app.get("/api/users/:id", authenticate, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const currentUser = req.user;
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID d'utilisateur invalide" });
      }

      if (!currentUser) {
        return res.status(401).json({ message: "Utilisateur non authentifié" });
      }
      
      // Vérifier les permissions - admin peut voir tous les utilisateurs, sinon seulement son propre profil
      if (currentUser.role !== "admin" && currentUser.id !== id) {
        return res.status(403).json({ message: "Accès non autorisé" });
      }
      
      const user = await storage.getUser(id);
      
      if (!user) {
        return res.status(404).json({ message: "Utilisateur non trouvé" });
      }
      
      return res.status(200).json({
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        loginCount: Number(user.loginCount ?? 0),
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt
      });
    } catch (error) {
      console.error("Get user error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Changer le mot de passe - Tous les utilisateurs authentifiés
  app.post("/api/users/change-password", authenticate, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Non authentifié" });
      }
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Mot de passe actuel et nouveau mot de passe requis" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ message: "Le nouveau mot de passe doit contenir au moins 6 caractères" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "Utilisateur non trouvé" });
      }

      // Verify current password - support both bcrypt and legacy SHA-256 with auto-migration
      let isValidPassword = await bcrypt.compare(currentPassword, user.password);
      
      // If bcrypt fails and the hash looks like SHA-256 (64 hex chars), try legacy verification
      if (!isValidPassword && user.password.length === 64 && /^[a-f0-9]{64}$/i.test(user.password)) {
        const sha256Hash = crypto.createHash("sha256").update(currentPassword).digest("hex");
        if (sha256Hash === user.password) {
          isValidPassword = true;
          console.log(`🔐 [PASSWORD CHANGE] Legacy SHA-256 hash detected for user ${userId}, will upgrade to bcrypt`);
        }
      }
      
      if (!isValidPassword) {
        return res.status(401).json({ message: "Mot de passe actuel incorrect" });
      }

      // Hash the new password with bcrypt
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update the password (also upgrades legacy SHA-256 to bcrypt)
      await storage.updateUser(userId, { password: hashedPassword });

      return res.status(200).json({ message: "Mot de passe modifié avec succès" });
    } catch (error) {
      console.error("Change password error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Vehicle Routes
  app.get("/api/vehicles", authenticate, async (req, res) => {
    try {
      const search = req.query.search as string | undefined;
      const status = req.query.status as string | undefined;
      const vehicleType = req.query.vehicle_type as string | undefined;
      const limit = parseInt(req.query.limit as string || "10");
      const offset = parseInt(req.query.offset as string || "0");
      const sortBy = req.query.sort_by as string | undefined;
      const sortOrder = (req.query.sort_order as string | undefined) === 'asc' ? 'asc' : 'desc';
      
      // Récupérer l'utilisateur connecté pour vérifier ses permissions
      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Non authentifié" });
      }
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(401).json({ message: "Utilisateur non trouvé" });
      }
      
      console.log("Requête reçue - Filtres:", { 
        search, 
        status, 
        vehicle_type: vehicleType,
        limit,
        offset,
        user_role: user.role,
        query_params: req.query
      });
      
      let result;
      
      // Temporairement, tous les utilisateurs voient tous les véhicules
      // TODO: Implémenter getVehiclesByOwner pour les clients
      console.log('🔍 About to call storage.getVehicles...');
      result = await storage.getVehicles(search, status, vehicleType, limit, offset, sortBy, sortOrder);
      console.log('🔍 Result from storage.getVehicles:', result);
      
      return res.status(200).json(result);
    } catch (error) {
      console.error("Get vehicles error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Route pour récupérer tous les véhicules (pour l'export)
  app.get("/api/vehicles/all", authenticate, async (req, res) => {
    try {
      const result = await storage.getVehicles(undefined, undefined, undefined, 1000, 0);
      return res.status(200).json(result.vehicles);
    } catch (error) {
      console.error("Get all vehicles error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Route pour vérifier si un véhicule existe par son immatriculation
  app.get("/api/vehicles/check/:registrationNumber", authenticate, async (req, res) => {
    try {
      const registrationNumber = req.params.registrationNumber;
      const vehicle = await storage.getVehicleByRegistration(registrationNumber);
      
      if (!vehicle) {
        return res.status(200).json({ exists: false });
      }
      
      return res.status(200).json({ 
        exists: true, 
        id: vehicle.id,
        registrationNumber: vehicle.registrationNumber
      });
    } catch (error) {
      console.error("Check vehicle error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/vehicles/:id", authenticate, async (req, res) => {
    try {
      const idOrRegistration = req.params.id;
      let vehicle;
      
      // Récupérer l'utilisateur connecté
      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Non authentifié" });
      }
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(401).json({ message: "Utilisateur non trouvé" });
      }
      
      // Essayons d'abord de l'interpréter comme un ID numérique
      const id = parseInt(idOrRegistration);
      
      if (!isNaN(id)) {
        // C'est un ID numérique
        vehicle = await storage.getVehicle(id);
      } else {
        // C'est probablement une immatriculation
        vehicle = await storage.getVehicleByRegistration(idOrRegistration);
      }
      
      if (!vehicle) {
        return res.status(404).json({ message: "Véhicule non trouvé" });
      }
      
      // Vérifier les permissions : les clients ne peuvent voir que leurs véhicules
      if (user.role === 'client' && vehicle.ownerId !== user.id) {
        return res.status(403).json({ message: "Accès non autorisé à ce véhicule" });
      }
      
      return res.status(200).json(vehicle);
    } catch (error) {
      console.error("Get vehicle error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/vehicles", isWorkshopManager, async (req, res) => {
    try {
      const parsedVehicle = insertVehicleSchema.parse(req.body);
      
      // Check if registration number already exists
      const existingVehicle = await storage.getVehicleByRegistration(parsedVehicle.registrationNumber);
      if (existingVehicle) {
        return res.status(400).json({ message: "Numéro d'immatriculation déjà utilisé" });
      }
      
      const vehicle = await storage.createVehicle(parsedVehicle, req.user?.id);
      
      // Enregistrer automatiquement le statut initial dans l'historique
      const { fleetStatisticsService } = await import('./services/fleet-statistics-service');
      await fleetStatisticsService.recordStatusChange(
        vehicle.id,
        vehicle.status,
        undefined,
        `Véhicule créé avec le statut ${vehicle.status}`
      );
      
      return res.status(201).json(vehicle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Données de véhicule invalides",
          errors: error.errors 
        });
      }
      
      console.error("Create vehicle error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Route pour activer un véhicule depuis un workflow complet
  app.post("/api/vehicles/activate-from-workflow", isWorkshopManager, async (req, res) => {
    try {
      const { vehicleData, workflowData } = req.body;
      
      // Valider les données du véhicule
      const parsedVehicle = insertVehicleSchema.parse(vehicleData);
      
      // Vérifier si l'immatriculation existe déjà
      const existingVehicle = await storage.getVehicleByRegistration(parsedVehicle.registrationNumber);
      if (existingVehicle) {
        return res.status(400).json({ message: "Numéro d'immatriculation déjà utilisé" });
      }
      
      // Créer le véhicule
      const vehicle = await storage.createVehicle(parsedVehicle, req.user?.id);
      
      // Importer les services nécessaires
      const { VehicleActivationService } = await import('./services/vehicle-activation-service-working');
      const { DocumentManagementService } = await import('./services/document-management-service');
      
      // Activer le véhicule avec toutes les données du workflow
      await VehicleActivationService.activateVehicleFromWorkflow(vehicle.id, {
        ...workflowData,
        vehicleId: vehicle.id,
      });

      // Traiter et sauvegarder les documents du workflow
      const userId = req.user?.id || 1;
      await DocumentManagementService.processWorkflowDocuments(workflowData, vehicle.id, userId);
      
      // Marquer le workflow comme terminé
      if (workflowData.sessionId) {
        const { workflowService } = await import('./services/workflow-service');
        const userId = req.user?.id || 1;
        await workflowService.completeWorkflow(userId, workflowData.sessionId);
      }
      
      // Enregistrer le statut initial dans l'historique
      const { fleetStatisticsService } = await import('./services/fleet-statistics-service');
      await fleetStatisticsService.recordStatusChange(
        vehicle.id,
        vehicle.status,
        undefined,
        `Véhicule créé via workflow d'acquisition`
      );
      
      return res.status(201).json(vehicle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Données de véhicule invalides",
          errors: error.errors 
        });
      }
      console.error("Create vehicle from workflow error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.patch("/api/vehicles/:id", isWorkshopManager, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de véhicule invalide" });
      }
      
      const vehicle = await storage.getVehicle(id);
      
      if (!vehicle) {
        return res.status(404).json({ message: "Véhicule non trouvé" });
      }
      
      // Récupérer l'ID de l'utilisateur connecté depuis la session
      const userId = req.user?.id;
      
      // Corps brut du formulaire : "" vaut champ vidé, et un type invalide
      // doit revenir en 400 plutôt qu'en échec silencieux du stockage.
      const { data, errors } = prepareColumnUpdate(vehicles, req.body);
      if (errors.length > 0) {
        return next(new AppError(400, "Certaines informations du véhicule sont invalides.", { fieldErrors: errors }));
      }

      const updatedVehicle = await storage.updateVehicle(id, data, userId);
      // Le stockage rend undefined quand l'écriture échoue : ne pas répondre 200.
      if (!updatedVehicle) {
        return res.status(500).json({ message: "Erreur serveur" });
      }

      return res.status(200).json(updatedVehicle);
    } catch (error) {
      console.error("Update vehicle error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.delete("/api/vehicles/:id", isAdmin, async (req, res) => {
    try {
      const { VehicleDeletionService } = await import('./services/vehicle-deletion-service-trigger');
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de véhicule invalide" });
      }
      
      const vehicle = await storage.getVehicle(id);
      
      if (!vehicle) {
        return res.status(404).json({ message: "Véhicule non trouvé" });
      }
      
      const reason = req.body?.reason || 'Suppression administrative';
      const result = await VehicleDeletionService.deleteVehicle(id, reason);
      
      return res.status(200).json({ 
        message: "Véhicule supprimé et archivé avec succès",
        result 
      });
    } catch (error) {
      console.error("Delete vehicle error:", error);
      return res.status(500).json({ 
        message: "Erreur lors de la suppression du véhicule",
        error: error instanceof Error ? error.message : "Erreur serveur"
      });
    }
  });

  // Route pour restaurer un véhicule archivé
  app.post("/api/vehicles/:id/restore", isAdmin, async (req, res) => {
    try {
      const { VehicleDeletionService } = await import('./services/vehicle-deletion-service-trigger');
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de véhicule invalide" });
      }
      
      await VehicleDeletionService.restoreVehicle(id);
      
      return res.status(200).json({ 
        message: "Véhicule restauré avec succès" 
      });
    } catch (error) {
      console.error("Restore vehicle error:", error);
      return res.status(500).json({ 
        message: "Erreur lors de la restauration du véhicule",
        error: error instanceof Error ? error.message : "Erreur serveur"
      });
    }
  });

  // Route pour lister les véhicules archivés
  app.get("/api/vehicles/archived", isAdmin, async (req, res) => {
    try {
      const { db } = await import('./db');
      const { sql } = await import('drizzle-orm');
      
      const result = await db.execute(sql`
        SELECT 
          original_vehicle_id as id,
          registration_number,
          brand,
          model,
          status,
          archived_at,
          archive_reason,
          notes
        FROM vehicle_archived
        ORDER BY archived_at DESC
      `);
      
      return res.status(200).json(result.rows);
    } catch (error) {
      console.error("Get archived vehicles error:", error);
      return res.status(500).json({ 
        message: "Erreur lors de la récupération des véhicules archivés",
        error: error instanceof Error ? error.message : "Erreur serveur"
      });
    }
  });

  // Vehicle Documents Routes
  app.get("/api/vehicles/:vehicleId/documents", isAnyUser, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId);
      
      if (isNaN(vehicleId)) {
        return res.status(400).json({ message: "ID de véhicule invalide" });
      }

      if (!(await canAccessOwned(req.user, () => vehicleDocumentationService.getVehicleOwnerId(vehicleId)))) {
        return res.status(403).json({ message: OUT_OF_SCOPE_MESSAGE });
      }
      
      const documents = await storage.getVehicleDocuments(vehicleId);
      
      return res.status(200).json(documents);
    } catch (error) {
      log.error({ err: error, requestId: req.requestId }, "lecture des documents du véhicule en échec");
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/vehicles/:vehicleId/documents/:type", isAnyUser, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId);
      const type = req.params.type;
      
      if (isNaN(vehicleId)) {
        return res.status(400).json({ message: "ID de véhicule invalide" });
      }
      
      if (!['carte_grise', 'assurance', 'visite_technique', 'taxe', 'autre'].includes(type)) {
        return res.status(400).json({ message: "Type de document invalide" });
      }

      if (!(await canAccessOwned(req.user, () => vehicleDocumentationService.getVehicleOwnerId(vehicleId)))) {
        return res.status(403).json({ message: OUT_OF_SCOPE_MESSAGE });
      }
      
      const documents = await storage.getVehicleDocumentsByType(vehicleId, type);
      
      return res.status(200).json(documents);
    } catch (error) {
      log.error({ err: error, requestId: req.requestId }, "lecture des documents du véhicule par type en échec");
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/documents/:id/download", isAnyUser, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de document invalide" });
      }
      
      const document = await storage.getVehicleDocument(id);
      
      if (!document) {
        return res.status(404).json({ message: "Document non trouvé" });
      }

      if (!(await canAccessOwned(req.user, () => vehicleDocumentationService.getVehicleOwnerId(document.vehicleId)))) {
        return res.status(403).json({ message: OUT_OF_SCOPE_MESSAGE });
      }

      const fs = await import("fs");

      // Chemin stocké en base : on ne sert qu'un fichier situé sous uploads/.
      const candidatePaths = uploadedFileCandidates(document.filePath);

      const existingPath = candidatePaths.find((candidatePath) =>
        fs.existsSync(candidatePath),
      );

      if (!existingPath) {
        return res.status(404).json({
          message: "Fichier introuvable sur le serveur",
        });
      }

      res.download(existingPath, document.filename, (err) => {
        if (err) {
          log.error({ err, requestId: req.requestId }, "envoi du document en échec");
          if (!res.headersSent) {
            return res.status(500).json({ message: "Erreur lors du téléchargement" });
          }
        }
      });
    } catch (error) {
      log.error({ err: error, requestId: req.requestId }, "téléchargement du document en échec");
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.patch("/api/documents/:id", isWorkshopManager, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de document invalide" });
      }
      
      const document = await storage.getVehicleDocument(id);
      
      if (!document) {
        return res.status(404).json({ message: "Document non trouvé" });
      }
      
      const { name, description, expiryDate } = req.body ?? {};
      const previousExpiryDate = document.expiryDate;

      // Le stockage avale l'erreur SQL : une date illisible revenait en 404.
      const { data, errors } = prepareColumnUpdate(vehicleDocuments, { name, description, expiryDate });
      if (typeof data.name === "string" && data.name.trim() === "") {
        errors.push({ field: "name", message: "Ce champ est obligatoire." });
      }
      if (errors.length > 0) {
        return next(new AppError(400, "Certaines informations du document sont invalides.", { fieldErrors: errors }));
      }

      const updatedDocument = await storage.updateVehicleDocument(id, {
        ...data,
        updatedBy: (req as any).user?.id || req.session?.userId || undefined,
      });

      if (!updatedDocument) {
        return res.status(404).json({ message: "Document non trouvé" });
      }

      const normalizeDocumentType = (rawType: string | null | undefined): string => {
        const normalized = String(rawType || "").trim().toLowerCase();
        switch (normalized) {
          case "insurance":
            return "assurance";
          case "inspection":
          case "technical_inspection":
          case "controle_technique":
            return "visite_technique";
          case "license":
          case "registration":
          case "registration_card":
            return "carte_grise";
          default:
            return normalized;
        }
      };

      const normalizedType = normalizeDocumentType(updatedDocument.type);
      if (expiryDate !== undefined && updatedDocument.expiryDate) {
        if (normalizedType === "carte_grise") {
          await db
            .update(vehicles)
            .set({ licensePlateExpiry: updatedDocument.expiryDate })
            .where(eq(vehicles.id, updatedDocument.vehicleId));
        } else if (normalizedType === "assurance") {
          await db
            .update(vehicles)
            .set({ insuranceExpiry: updatedDocument.expiryDate })
            .where(eq(vehicles.id, updatedDocument.vehicleId));
        } else if (normalizedType === "visite_technique") {
          await db
            .update(vehicles)
            .set({ technicalInspectionDate: updatedDocument.expiryDate })
            .where(eq(vehicles.id, updatedDocument.vehicleId));
        }
      }

      const broadcastUpdate = (global as any).broadcastUpdate;
      if (typeof broadcastUpdate === "function") {
        const actorUserId = (req as any).user?.id || req.session?.userId || null;
        const actorRole = (req as any).user?.role || req.session?.role || null;

        broadcastUpdate("vehicle_document_updated", {
          version: 1,
          entity: "document_renewal_request",
          entityId: updatedDocument.id,
          payload: {
            documentId: updatedDocument.id,
            vehicleId: updatedDocument.vehicleId,
            documentType: updatedDocument.type,
            previousExpiryDate: previousExpiryDate ?? null,
            newExpiryDate: updatedDocument.expiryDate ?? null,
            source: "legacy_document_patch",
          },
          scope: { type: "broadcast" },
          actor: {
            userId: actorUserId,
            role: actorRole,
          },
          emittedAt: new Date().toISOString(),
        });

        broadcastUpdate("vehicle_updated", {
          version: 1,
          entity: "vehicle",
          entityId: updatedDocument.vehicleId,
          payload: {
            vehicleId: updatedDocument.vehicleId,
            source: "legacy_document_patch",
          },
          scope: { type: "broadcast" },
          actor: {
            userId: actorUserId,
            role: actorRole,
          },
          emittedAt: new Date().toISOString(),
        });
      }
      
      return res.status(200).json(updatedDocument);
    } catch (error) {
      log.error({ err: error, requestId: req.requestId }, "Update vehicle document error");
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.delete("/api/documents/:id", isWorkshopManager, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de document invalide" });
      }
      
      const document = await storage.getVehicleDocument(id);
      
      if (!document) {
        return res.status(404).json({ message: "Document non trouvé" });
      }
      
      // Faux si un autre utilisateur l'a supprimé entre la lecture et la suppression.
      const deleted = await storage.deleteVehicleDocument(id);
      if (!deleted) {
        return res.status(404).json({ message: "Document non trouvé" });
      }

      // `documentId` dans un `vehicle_updated` : le client resynchronise la liste
      // des documents, les KPI conformité et les alertes d'échéance.
      const broadcastUpdate = (global as any).broadcastUpdate;
      if (typeof broadcastUpdate === "function") {
        broadcastUpdate("vehicle_updated", {
          version: 1,
          entity: "vehicle",
          entityId: document.vehicleId,
          payload: {
            vehicleId: document.vehicleId,
            documentId: document.id,
            documentType: document.type,
            source: "document_deleted",
          },
          scope: { type: "broadcast" },
          actor: {
            userId: (req as any).user?.id || req.session?.userId || null,
            role: (req as any).user?.role || req.session?.role || null,
          },
          emittedAt: new Date().toISOString(),
        });
      }

      return res.status(204).send();
    } catch (error) {
      log.error({ err: error, requestId: req.requestId }, "Delete vehicle document error");
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Maintenance Schedule Routes
  app.get("/api/maintenance-schedules", authenticate, async (req, res) => {
    try {
      // Récupérer l'utilisateur connecté pour filtrer les données
      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Non authentifié" });
      }
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(401).json({ message: "Utilisateur non trouvé" });
      }
      
      // Une seule requête, quel que soit le nombre de véhicules. La boucle
      // précédente interrogeait la base une fois par camion: 7 allers-retours
      // pour 6 véhicules, ~3 secondes à la latence de ce déploiement.
      let schedules;
      if (user.role === 'client') {
        // Le client ne voit que son parc: on lui passe la liste de ses véhicules.
        const vehiclesResult = await storage.getVehiclesByOwner(user.id);
        schedules = await storage.getMaintenanceSchedules(
          vehiclesResult.vehicles.map((vehicle) => vehicle.id),
        );
      } else {
        schedules = await storage.getMaintenanceSchedules();
      }

      return res.status(200).json(schedules);
    } catch (error) {
      console.error("Get all maintenance schedules error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/maintenance-schedules/vehicle/:vehicleId", authenticate, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId);
      
      if (isNaN(vehicleId)) {
        return res.status(400).json({ message: "ID de véhicule invalide" });
      }
      
      // Vérifier les permissions d'accès au véhicule
      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Non authentifié" });
      }
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(401).json({ message: "Utilisateur non trouvé" });
      }
      
      // Les clients ne peuvent voir que les planifications de leurs véhicules
      if (user.role === 'client') {
        const vehicle = await storage.getVehicle(vehicleId);
        if (!vehicle || vehicle.ownerId !== user.id) {
          return res.status(403).json({ message: "Accès refusé - Ce n'est pas votre véhicule" });
        }
      }
      
      const schedules = await preventiveMaintenanceService.getVehicleMaintenanceSchedules(vehicleId);
      
      return res.status(200).json(schedules);
    } catch (error) {
      console.error("Get maintenance schedules error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/maintenance-schedules", isWorkshopManager, async (req, res) => {
    try {
      // Valider les données d'entrée
      const validationSchema = z.object({
        vehicleId: z.number(),
        title: z.string().min(1),
        description: z.string().optional(),
        frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'mileage']),
        frequencyValue: z.number().min(1),
        scheduledDate: z.string(),
        scheduledMileage: z.number().optional(),
        isActive: z.boolean().default(true)
      });

      const scheduleData = validationSchema.parse(req.body);
      
      // Utiliser le service pour créer la planification et générer automatiquement l'OT
      const schedule = await preventiveMaintenanceService.createMaintenanceSchedule(scheduleData);
      
      return res.status(201).json(schedule);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Données de planification invalides",
          errors: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }
      
      console.error("Create maintenance schedule error:", error);
      return res.status(500).json({ 
        message: "Erreur lors de la création de la planification de maintenance",
        details: error instanceof Error ? error.message : "Erreur inconnue"
      });
    }
  });

  // Récupérer toutes les planifications de maintenance
  app.get("/api/maintenance-schedules", authenticate, async (req, res) => {
    try {
      const { vehicleId, active } = req.query;

      const filters: any[] = [];

      if (vehicleId) {
        const parsedVehicleId = parseInt(vehicleId as string);
        if (!isNaN(parsedVehicleId)) {
          filters.push(eq(maintenanceSchedules.vehicleId, parsedVehicleId));
        }
      }

      if (active !== undefined) {
        filters.push(eq(maintenanceSchedules.isActive, active === "true"));
      }

      const whereClause = filters.length === 0
        ? undefined
        : filters.length === 1
          ? filters[0]
          : and(...filters);

      const schedules = whereClause
        ? await db
            .select()
            .from(maintenanceSchedules)
            .where(whereClause)
            .orderBy(desc(maintenanceSchedules.createdAt))
        : await db
            .select()
            .from(maintenanceSchedules)
            .orderBy(desc(maintenanceSchedules.createdAt));
      
      return res.json(schedules);
    } catch (error) {
      console.error('Get maintenance schedules error:', error);
      return res.status(500).json({
        message: "Erreur lors de la récupération des planifications"
      });
    }
  });

  // Générer un ordre de travail depuis une planification
  app.post("/api/maintenance-schedules/:id/generate-work-order", isWorkshopManager, async (req, res) => {
    try {
      const { id } = req.params;
      
      // Récupérer la planification
      const [schedule] = await db
        .select()
        .from(maintenanceSchedules)
        .where(eq(maintenanceSchedules.id, parseInt(id)));
      
      if (!schedule) {
        return res.status(404).json({ message: "Planification non trouvée" });
      }
      
      // Utiliser le service pour générer l'ordre de travail
      const workOrder = await preventiveMaintenanceService.generateWorkOrderFromSchedule(schedule);
      
      return res.status(201).json(workOrder);
    } catch (error) {
      console.error('Generate work order error:', error);
      return res.status(500).json({
        message: "Erreur lors de la génération de l'ordre de travail",
        details: error instanceof Error ? error.message : "Erreur inconnue"
      });
    }
  });

  // Désactiver/Activer une planification
  // Activation (écran préventif, corps { isActive }) et édition complète
  // (formulaire). Une ancienne route n'écrivait que isActive et masquait
  // celle-ci : toute édition depuis le formulaire était perdue en silence.
  app.patch("/api/maintenance-schedules/:id", isWorkshopManager, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);

      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de planification invalide" });
      }

      const schedule = await storage.getMaintenanceSchedule(id);

      if (!schedule) {
        return res.status(404).json({ message: "Planification non trouvée" });
      }

      // Le formulaire renvoie la fiche entière : id et createdAt sont ignorés.
      const { id: _id, createdAt: _createdAt, ...schedulePayload } = req.body ?? {};
      const { data, errors } = prepareColumnUpdate(maintenanceSchedules, schedulePayload);
      if (errors.length > 0) {
        return next(new AppError(400, "Certaines informations de la planification sont invalides.", { fieldErrors: errors }));
      }
      const columns = getTableColumns(maintenanceSchedules);
      const updates = Object.fromEntries(Object.entries(data).filter(([key, value]) => key in columns && value !== undefined));
      if (Object.keys(updates).length === 0) {
        return next(new AppError(400, "Aucune modification à enregistrer."));
      }

      const updatedSchedule = await storage.updateMaintenanceSchedule(id, updates);

      return res.status(200).json(updatedSchedule);
    } catch (error) {
      log.error({ err: error, requestId: req.requestId }, "Update maintenance schedule error");
      return res.status(500).json({ message: "Erreur lors de la modification de la planification" });
    }
  });

  // Route pour les statistiques de maintenance préventive
  app.get("/api/maintenance-schedules/statistics", isWorkshopManager, async (req, res) => {
    try {
      const stats = await preventiveMaintenanceService.getMaintenanceStatistics();
      return res.status(200).json(stats);
    } catch (error) {
      console.error("Get maintenance statistics error:", error);
      return res.status(500).json({ message: "Erreur lors de la récupération des statistiques" });
    }
  });

  // Route pour les prochaines maintenances
  app.get("/api/maintenance-schedules/upcoming", isWorkshopManager, async (req, res) => {
    try {
      const daysAhead = parseInt(req.query.days as string) || 30;
      const upcomingMaintenances = await preventiveMaintenanceService.getUpcomingMaintenances(daysAhead);
      return res.status(200).json(upcomingMaintenances);
    } catch (error) {
      console.error("Get upcoming maintenances error:", error);
      return res.status(500).json({ message: "Erreur lors de la récupération des maintenances à venir" });
    }
  });

  app.delete("/api/maintenance-schedules/:id", isWorkshopManager, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de planification invalide" });
      }
      
      const schedule = await storage.getMaintenanceSchedule(id);
      
      if (!schedule) {
        return res.status(404).json({ message: "Planification non trouvée" });
      }
      
      await storage.deleteMaintenanceSchedule(id);
      
      return res.status(204).send();
    } catch (error) {
      console.error("Delete maintenance schedule error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Work Order Routes
  app.get("/api/work-orders/statistics", authenticate, async (req, res) => {
    try {
      // Récupérer le paramètre de période (week, month, quarter, year)
      const period = req.query.period as string || 'year';
      
      // Calculer la date de début selon la période
      const now = new Date();
      let startDate: Date;
      
      switch (period) {
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'quarter':
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case 'year':
        default:
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
      }
      
      const [statsRow] = await db
        .select({
          pending: sql<number>`COUNT(*) FILTER (WHERE ${workOrders.status} = 'pending')`,
          inProgress: sql<number>`COUNT(*) FILTER (WHERE ${workOrders.status} = 'in_progress')`,
          awaitingParts: sql<number>`COUNT(*) FILTER (WHERE ${workOrders.status} = 'awaiting_parts')`,
          completed: sql<number>`COUNT(*) FILTER (WHERE ${workOrders.status} = 'completed')`,
          cancelled: sql<number>`COUNT(*) FILTER (WHERE ${workOrders.status} = 'cancelled')`,
          total: sql<number>`COUNT(*)`,
        })
        .from(workOrders)
        .where(gte(workOrders.createdAt, startDate));

      const stats = {
        pending: Number(statsRow?.pending ?? 0),
        inProgress: Number(statsRow?.inProgress ?? 0),
        awaitingParts: Number(statsRow?.awaitingParts ?? 0),
        completed: Number(statsRow?.completed ?? 0),
        cancelled: Number(statsRow?.cancelled ?? 0),
      };
      
      console.log("Work orders statistics calculated:", stats);
      
      return res.status(200).json(stats);
    } catch (error) {
      console.error("Get work orders statistics error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Obtenir les OT en attente de pièces (pour le magasinier)
  app.get("/api/work-orders/awaiting-parts", authenticate, async (req, res) => {
    try {
      // Récupérer tous les OT en attente de pièces
      const result = await storage.getWorkOrders('awaiting_parts', undefined, 100, 0);

      if (result.workOrders.length === 0) {
        return res.status(200).json({
          workOrders: [],
          total: result.total
        });
      }

      // Éviter le N+1: charger les demandes une seule fois pour toutes les OT.
      const allRequests = await storage.getPartRequirements();
      const activeRequestStatuses = new Set(['pending', 'approved', 'ordered']);
      const requestsByWorkOrderId = new Map<number, typeof allRequests>();
      for (const request of allRequests) {
        if (!request.workOrderId || !activeRequestStatuses.has(request.status)) {
          continue;
        }
        const existing = requestsByWorkOrderId.get(request.workOrderId) || [];
        existing.push(request);
        requestsByWorkOrderId.set(request.workOrderId, existing);
      }

      const vehicleCache = new Map<number, Awaited<ReturnType<typeof storage.getVehicle>>>();
      const technicianCache = new Map<number, Awaited<ReturnType<typeof storage.getUser>>>();

      // Enrichir avec les détails des pièces manquantes et demandes associées
      const enrichedWorkOrders = await Promise.all(
        result.workOrders.map(async (workOrder) => {
          const relatedRequests = requestsByWorkOrderId.get(workOrder.id) || [];
          
          // Récupérer le véhicule
          let vehicle = vehicleCache.get(workOrder.vehicleId);
          if (!vehicle) {
            vehicle = await storage.getVehicle(workOrder.vehicleId);
            vehicleCache.set(workOrder.vehicleId, vehicle);
          }
          
          // Récupérer le technicien assigné
          let technician: Awaited<ReturnType<typeof storage.getUser>> | null = null;
          if (workOrder.technicianId) {
            const cachedTechnician = technicianCache.get(workOrder.technicianId);
            if (cachedTechnician) {
              technician = cachedTechnician;
            } else {
              technician = await storage.getUser(workOrder.technicianId);
              technicianCache.set(workOrder.technicianId, technician);
            }
          }
          
          return {
            ...workOrder,
            vehicle: vehicle ? {
              registrationNumber: vehicle.registrationNumber,
              brand: vehicle.brand,
              model: vehicle.model
            } : null,
            technician: technician ? { name: technician.name } : null,
            pendingParts: relatedRequests.map((r) => ({
              requestId: r.id,
              partId: r.partId,
              partName: r.partName,
              partReference: r.partReference,
              quantityNeeded: r.quantityNeeded,
              status: r.status,
              urgency: r.urgency,
              expectedDeliveryDate: r.expectedDeliveryDate
            })),
            pendingPartsCount: relatedRequests.length
          };
        })
      );
      
      return res.status(200).json({
        workOrders: enrichedWorkOrders,
        total: result.total
      });
    } catch (error) {
      console.error("Get awaiting parts work orders error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/work-orders", authenticate, async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const priority = req.query.priority as string | undefined;
      const search = req.query.search as string | undefined;
      const requestedLimit = Number.parseInt((req.query.limit as string) || "50", 10);
      const requestedOffset = Number.parseInt((req.query.offset as string) || "0", 10);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), 500)
        : 50;
      const offset = Number.isFinite(requestedOffset)
        ? Math.max(requestedOffset, 0)
        : 0;
      
      // Récupérer l'utilisateur connecté pour vérifier ses permissions
      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Non authentifié" });
      }
      const user = await storage.getUser(userId);
      
      console.log(`📋 GET /api/work-orders - User: ${user?.username} (role: ${user?.role}), status: ${status}, limit: ${limit}, offset: ${offset}`);
      
      if (!user) {
        return res.status(401).json({ message: "Utilisateur non trouvé" });
      }
      
      let result;
      
      // Filtrage par rôle
      if (user.role === 'client') {
        // Les clients ne voient que les ordres de travail de leurs véhicules
        result = await storage.getWorkOrdersByOwner(user.id, status, priority, limit, offset);
      } else if (user.role === 'technician') {
        // Les techniciens voient leurs ordres assignés + tous les ordres non assignés
        result = await storage.getWorkOrdersForTechnician(user.id, status, priority, limit, offset);
      } else {
        // Admin et workshop_manager voient tout
        console.log(`📋 Calling getWorkOrders for ${user.role}`);
        result = await storage.getWorkOrders(status, priority, limit, offset, search);
        console.log(`📋 Got ${result.workOrders.length} work orders, total: ${result.total}`);
      }
      
      // Pas de N+1: réutilise technicianName déjà joint côté storage.
      const enrichedWorkOrders = result.workOrders.map((workOrder: any) => {
        if (!workOrder.technicianId) {
          return workOrder;
        }

        return {
          ...workOrder,
          technician: workOrder.technicianName
            ? { name: workOrder.technicianName }
            : null,
        };
      });
      
      return res.status(200).json({
        ...result,
        workOrders: enrichedWorkOrders
      });
    } catch (error) {
      console.error("Get work orders error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Get single work order by ID (MUST be before other specific routes)
  app.get("/api/work-orders/:id", authenticate, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID d'ordre de travail invalide" });
      }
      
      const workOrder = await storage.getWorkOrder(id);
      console.log("Work order retrieved:", JSON.stringify(workOrder, null, 2));
      
      if (!workOrder) {
        return res.status(404).json({ message: "Ordre de travail non trouvé" });
      }
      
      // Vérifier les permissions d'accès selon le rôle
      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Non authentifié" });
      }
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(401).json({ message: "Utilisateur non trouvé" });
      }
      
      // Les clients ne peuvent voir que les ordres de travail de leurs véhicules
      if (user.role === 'client') {
        const vehicle = await storage.getVehicle(workOrder.vehicleId);
        if (!vehicle || vehicle.ownerId !== user.id) {
          return res.status(403).json({ message: "Accès refusé - Ce n'est pas votre véhicule" });
        }
      }
      
      // Les techniciens ne peuvent voir que leurs ordres assignés ou les ordres non assignés
      if (user.role === 'technician') {
        if (workOrder.technicianId && workOrder.technicianId !== user.id) {
          return res.status(403).json({ message: "Accès refusé - Ordre de travail assigné à un autre technicien" });
        }
      }
      
      return res.status(200).json(workOrder);
    } catch (error) {
      console.error("Get work order error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/work-orders/vehicle/:vehicleId", authenticate, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId);
      
      if (isNaN(vehicleId)) {
        return res.status(400).json({ message: "ID de véhicule invalide" });
      }
      
      const orders = await storage.getWorkOrdersByVehicleId(vehicleId);
      
      return res.status(200).json(orders);
    } catch (error) {
      console.error("Get vehicle work orders error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/work-orders/technician/:technicianId", isTechnician, async (req, res) => {
    try {
      const technicianId = parseInt(req.params.technicianId);
      
      if (isNaN(technicianId)) {
        return res.status(400).json({ message: "ID de technicien invalide" });
      }

      // Un technicien ne consulte que ses propres OT ; chef d'atelier et admin, tous.
      if (req.user?.role === "technician" && req.user.id !== technicianId) {
        return res.status(403).json({ message: "Vous ne pouvez consulter que vos propres ordres de travail." });
      }

      const orders = await storage.getWorkOrdersByTechnicianId(technicianId);

      return res.status(200).json(orders);
    } catch (error) {
      log.error({ err: error, requestId: req.requestId }, "Get technician work orders error");
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/work-orders", isWorkshopManager, async (req, res) => {
    try {
      log.debug({ requestId: req.requestId, body: req.body }, "Données reçues pour création OT");
      
      const parsedWorkOrder = insertWorkOrderSchema.parse(req.body);
      const actorUserId = typeof req.session?.userId === "number" ? req.session.userId : null;

      // Règle métier: à la création, une OT démarre toujours "en attente"
      parsedWorkOrder.status = 'pending';
      // Le créateur d'une OT manuelle est toujours l'utilisateur connecté.
      if (actorUserId) {
        parsedWorkOrder.createdBy = actorUserId;
        parsedWorkOrder.updatedBy = actorUserId;
      }
      
      // Récupérer l'immatriculation du véhicule si elle n'est pas fournie
      if (!parsedWorkOrder.vehicleRegistration && parsedWorkOrder.vehicleId) {
        const vehicle = await storage.getVehicle(parsedWorkOrder.vehicleId);
        if (vehicle) {
          parsedWorkOrder.vehicleRegistration = vehicle.registrationNumber;
        }
      }
      
      console.log("Données après parsing:", JSON.stringify(parsedWorkOrder, null, 2));
      
      const workOrder = await storage.createWorkOrder(parsedWorkOrder);
      
      // If a maintenance schedule is associated, update the vehicle status
      if (parsedWorkOrder.maintenanceScheduleId) {
        const vehicle = await storage.getVehicle(parsedWorkOrder.vehicleId);
        if (vehicle && vehicle.status === 'operational') {
          await storage.updateVehicle(parsedWorkOrder.vehicleId, { status: 'maintenance' });
        }
      }

      if (workOrder.technicianId) {
        const vehicule = workOrder.vehicleId
          ? await storage.getVehicle(workOrder.vehicleId)
          : null;

        try {
          await alertService.notifyWorkOrderAssigned({
            workOrderId: workOrder.id,
            workOrderTitle: workOrder.title,
            technicianUserId: workOrder.technicianId,
            assignedByName: (req.user as any)?.name ?? (req.user as any)?.username ?? null,
            vehicleRegistration: vehicule?.registrationNumber ?? workOrder.vehicleRegistration ?? null,
          });
        } catch (error) {
          console.error("Alerte d'affectation à la création non envoyée:", error);
        }
      }

      if ((global as any).broadcastUpdate) {
        (global as any).broadcastUpdate("work_order_created", {
          workOrderId: workOrder.id,
          workOrder,
          source: "manual_work_order",
          triggeredBy: req.user?.id ?? null,
          actor: actorUserId ? { userId: actorUserId } : null,
        });
      }
      
      return res.status(201).json(workOrder);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error("Erreurs de validation Zod:", JSON.stringify(error.errors, null, 2));
        return res.status(400).json({ 
          message: "Données d'ordre de travail invalides",
          errors: error.errors 
        });
      }
      
      console.error("Create work order error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.patch("/api/work-orders/:id", isTechnician, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID d'ordre de travail invalide" });
      }
      
      const workOrder = await storage.getWorkOrder(id);
      
      if (!workOrder) {
        return res.status(404).json({ message: "Ordre de travail non trouvé" });
      }
      
      const { data: updatedData, errors } = prepareColumnUpdate(workOrders, { ...req.body });
      if (errors.length > 0) {
        return next(new AppError(400, "Certaines informations de l'ordre de travail sont invalides.", { fieldErrors: errors }));
      }
      
      // Convert date strings to Date objects for Drizzle ORM
      if (updatedData.startDate && typeof updatedData.startDate === 'string') {
        updatedData.startDate = new Date(updatedData.startDate);
      }
      if (updatedData.endDate && typeof updatedData.endDate === 'string') {
        updatedData.endDate = new Date(updatedData.endDate);
      }
      
      // If the status is being updated to completed, update the endDate if not provided
      if (updatedData.status === 'completed' && !updatedData.endDate) {
        updatedData.endDate = new Date();
      }
      
      const updatedWorkOrder = await storage.updateWorkOrder(id, updatedData);

      // Affectation à un technicien: le prévenir nommément. Sans ça, le chef
      // d'atelier lisait « OT mis à jour » et le technicien ne voyait rien —
      // il découvrait son travail en ouvrant la liste, ou pas du tout.
      // Non bloquant: l'OT est enregistrée, une notification qui échoue ne doit
      // pas faire échouer la réponse.
      const nouveauTechnicien = Number(updatedData.technicianId);
      const affectationChangee =
        Number.isInteger(nouveauTechnicien) &&
        nouveauTechnicien > 0 &&
        nouveauTechnicien !== workOrder.technicianId;

      if (affectationChangee) {
        const vehicule = workOrder.vehicleId
          ? await storage.getVehicle(workOrder.vehicleId)
          : null;

        try {
          await alertService.notifyWorkOrderAssigned({
            workOrderId: id,
            workOrderTitle: updatedWorkOrder?.title || workOrder.title,
            technicianUserId: nouveauTechnicien,
            assignedByName: (req.user as any)?.name ?? (req.user as any)?.username ?? null,
            vehicleRegistration: vehicule?.registrationNumber ?? null,
          });
        } catch (error) {
          console.error("Alerte d'affectation non envoyée:", error);
        }
      }

      // Avancement: remonter vers l'encadrement atelier. L'affectation
      // descendait, rien ne remontait — or c'est le chef qui replace le camion
      // une fois l'intervention finie, et qui débloque une pièce manquante.
      const statutsRemontes = ["in_progress", "completed", "awaiting_parts"] as const;
      type StatutRemonte = (typeof statutsRemontes)[number];
      const nouveauStatut = String(updatedData.status || "");
      const statutRemonte =
        statutsRemontes.includes(nouveauStatut as StatutRemonte) &&
        nouveauStatut !== workOrder.status;

      if (statutRemonte) {
        // Nommer celui qui a RÉELLEMENT agi, pas le technicien assigné: le chef
        // d'atelier peut démarrer une intervention sans se l'attribuer, et
        // annoncer « Ali a commencé » serait faux.
        const acteurId = typeof req.session?.userId === "number" ? req.session.userId : null;
        const technicienFinalId = updatedWorkOrder?.technicianId ?? workOrder.technicianId;

        const [vehiculeOt, acteur] = await Promise.all([
          workOrder.vehicleId ? storage.getVehicle(workOrder.vehicleId) : null,
          acteurId ? storage.getUser(acteurId) : null,
        ]);

        alertService
          .notifyWorkOrderProgress({
            workOrderId: id,
            workOrderTitle: updatedWorkOrder?.title || workOrder.title,
            newStatus: nouveauStatut as StatutRemonte,
            technicianName: acteur?.name ?? null,
            vehicleRegistration: vehiculeOt?.registrationNumber ?? null,
            // L'auteur n'a pas à être prévenu de son propre geste.
            excludeUserId: acteurId,
          })
          .catch((error) => {
            console.error("Alerte d'avancement non envoyée:", error);
          });
      }

      // Diffuser la mise à jour via WebSocket temps réel
      if ((global as any).broadcastUpdate) {
        const actorUserId = typeof req.session?.userId === "number" ? req.session.userId : null;
        (global as any).broadcastUpdate('work_order_updated', {
          workOrderId: id,
          updates: updatedData,
          workOrder: updatedWorkOrder,
          actor: actorUserId ? { userId: actorUserId } : null,
        });
      }
      
      // If work order is completed, update vehicle status back to operational
      if (updatedData.status === 'completed') {
        const vehicle = await storage.getVehicle(workOrder.vehicleId);
        if (vehicle && vehicle.status === 'maintenance') {
          // Check if there are other active work orders for this vehicle
          const activeOrders = await storage.getWorkOrdersByVehicleId(workOrder.vehicleId);
          const otherActiveOrders = activeOrders.filter(order => 
            order.id !== id && 
            ['pending', 'in_progress'].includes(order.status)
          );
          
          if (otherActiveOrders.length === 0) {
            await storage.updateVehicle(workOrder.vehicleId, { status: 'operational' });
          }
        }
      }
      
      return res.status(200).json(updatedWorkOrder);
    } catch (error) {
      console.error("Update work order error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Suppression en masse des OT en attente et non assignés (admin uniquement)
  // DOIT être déclaré AVANT la route /:id pour éviter le conflit de pattern
  app.delete("/api/work-orders/bulk-pending-unassigned", authenticate, isAdmin, async (req, res) => {
    try {
      const toDelete = await db
        .select({
          id: workOrders.id,
          title: workOrders.title,
          status: workOrders.status,
          priority: workOrders.priority,
          vehicleId: workOrders.vehicleId,
          vehicleRegistrationNumber: vehicles.registrationNumber,
          technicianId: workOrders.technicianId,
        })
        .from(workOrders)
        .leftJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
        .where(and(
          eq(workOrders.status, "pending"),
          isNull(workOrders.technicianId),
        ));
      const userAgentHeader = req.headers["user-agent"];
      const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader.join(" | ") : userAgentHeader;

      let deleted = 0;
      let failed = 0;
      for (const wo of toDelete) {
        const removed = await storage.deleteWorkOrder(wo.id);
        if (removed) {
          deleted++;

          try {
            await activityLogger.logDelete({
              userId: req.user?.id,
              entityType: "work_order",
              entityId: wo.id,
              entityData: {
                title: wo.title,
                status: wo.status,
                priority: wo.priority,
                vehicleId: wo.vehicleId,
                vehicleRegistrationNumber: wo.vehicleRegistrationNumber ?? null,
                technicianId: wo.technicianId ?? null,
                source: "bulk_pending_unassigned_delete",
              },
              ipAddress: req.ip,
              userAgent,
            });
          } catch (logError) {
            console.warn("Bulk delete audit log error:", logError);
          }

          if ((global as any).broadcastUpdate) {
            (global as any).broadcastUpdate('work_order_deleted', {
              workOrderId: wo.id,
              vehicleId: wo.vehicleId,
              source: "bulk_pending_unassigned_delete",
              triggeredBy: req.user?.id ?? null,
            });
          }
        } else {
          failed++;
        }
      }

      try {
        await activityLogger.logCustomAction({
          userId: req.user?.id,
          action: "BULK_DELETE_PENDING_UNASSIGNED_WORK_ORDERS",
          entityType: "work_order_bulk",
          description: "Purge des OT en attente non assignés",
          metadata: {
            attempted: toDelete.length,
            deleted,
            failed,
            targetStatus: "pending",
            targetAssignment: "unassigned",
          },
          ipAddress: req.ip,
          userAgent,
        });
      } catch (logError) {
        console.warn("Bulk summary audit log error:", logError);
      }

      const actorUserId = typeof req.session?.userId === "number" ? req.session.userId : undefined;
      const statusReconciliation = await reconcileVehicleStatusesFromWorkOrders(actorUserId);

      return res.status(200).json({
        deleted,
        failed,
        attempted: toDelete.length,
        statusReconciliation,
        message: failed > 0
          ? `${deleted} ordre(s) supprimé(s), ${failed} échec(s)`
          : `${deleted} ordre(s) supprimé(s)`,
      });
    } catch (error) {
      console.error("Bulk delete pending work orders error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.delete("/api/work-orders/:id", isWorkshopManager, async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      if (isNaN(id)) {
        return res.status(400).json({ message: "ID d'ordre de travail invalide" });
      }

      const workOrder = await storage.getWorkOrder(id);

      if (!workOrder) {
        return res.status(404).json({ message: "Ordre de travail non trouvé" });
      }

      const deleted = await storage.deleteWorkOrder(id);
      if (!deleted) {
        return res.status(500).json({ message: "Erreur lors de la suppression de l'ordre de travail" });
      }

      try {
        const userAgentHeader = req.headers["user-agent"];
        const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader.join(" | ") : userAgentHeader;
        await activityLogger.logDelete({
          userId: req.user?.id,
          entityType: "work_order",
          entityId: id,
          entityData: {
            title: workOrder.title,
            status: workOrder.status,
            priority: workOrder.priority,
            vehicleId: workOrder.vehicleId,
            technicianId: workOrder.technicianId ?? null,
            source: "manual_work_order_delete",
          },
          ipAddress: req.ip,
          userAgent,
        });
      } catch (logError) {
        console.warn("Manual delete audit log error:", logError);
      }

      if ((global as any).broadcastUpdate) {
        (global as any).broadcastUpdate('work_order_deleted', {
          workOrderId: id,
          vehicleId: workOrder.vehicleId,
          source: "manual_work_order_delete",
          triggeredBy: req.user?.id ?? null,
        });
      }

      return res.status(204).send();
    } catch (error) {
      console.error("Delete work order error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // API unifiée pour les ordres de travail du technicien - source unique pour toutes les pages
  app.get("/api/technician/work-orders/:technicianId", isTechnician, async (req: Request, res: Response) => {
    try {
      const technicianId = parseInt(req.params.technicianId);
      
      if (isNaN(technicianId)) {
        return res.status(400).json({ message: "ID technicien invalide" });
      }

      // Un technicien ne lit que ses propres ordres; l'atelier lit ceux de tous.
      if (req.user?.role === "technician" && req.user.id !== technicianId) {
        return res.status(403).json({ message: "Accès non autorisé" });
      }
      
      console.log(`🔧 [UNIFIED-WO] API unifiée - Récupération des ordres pour le technicien ${technicianId}`);
      
      // Utiliser le service spécialisé TechnicianWorkOrdersService
      const technicianService = new TechnicianWorkOrdersService();
      const workOrders = await technicianService.getTechnicianWorkOrders(technicianId);
      const stats = await technicianService.getTechnicianWorkOrderStats(technicianId);
      
      console.log(`🔧 [UNIFIED-WO] Trouvé ${workOrders.length} ordres pour le technicien`);
      console.log(`📊 [UNIFIED-WO] Stats: ${JSON.stringify(stats)}`);
      
      return res.status(200).json({
        workOrders,
        stats
      });
    } catch (error) {
      console.error('🚨 [UNIFIED-WO] Erreur lors de la récupération des ordres:', error);
      return res.status(500).json({ 
        message: "Erreur lors de la récupération des ordres de travail" 
      });
    }
  });

  // Route spécialisée pour les ordres de travail d'un technicien
  app.get("/api/technician/my-work-orders", authenticate, async (req, res) => {
    try {
      const userId = req.session?.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Non authentifié" });
      }
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'technician') {
        return res.status(403).json({ message: "Accès réservé aux techniciens" });
      }

      console.log(`🔧 [MY-WO] Récupération des ordres pour technicien: ${user.name} (ID: ${userId})`);
      console.log(`🔧 [MY-WO] Utilisation du service TechnicianWorkOrdersService`);
      
      // Utiliser le service spécialisé qui calcule les coûts totaux
      const technicianService = new TechnicianWorkOrdersService();
      const enrichedOrders = await technicianService.getTechnicianWorkOrders(userId);
      console.log(`🔧 [MY-WO] Service terminé, ${enrichedOrders.length} ordres enrichis`);

      const stats = {
        pending: enrichedOrders.filter(wo => wo.status === 'pending').length,
        inProgress: enrichedOrders.filter(wo => wo.status === 'in_progress').length,
        completed: enrichedOrders.filter(wo => wo.status === 'completed').length,
        total: enrichedOrders.length
      };

      console.log(`🔧 [MY-WO] Trouvé ${enrichedOrders.length} ordres pour le technicien`);
      console.log(`📊 [MY-WO] Stats:`, stats);

      return res.status(200).json({
        workOrders: enrichedOrders,
        stats: stats,
        total: enrichedOrders.length
      });
    } catch (error) {
      console.error("Get technician work orders error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // PATCH /api/technician/work-orders/:id/status : server/api/technician-work-orders.routes.ts

  // Parts Inventory Routes
  app.get("/api/parts", authenticate, async (req, res) => {
    try {
      const search = req.query.search as string | undefined;
      const limit = parseInt(req.query.limit as string || "10");
      const page = Math.floor(parseInt(req.query.offset as string || "0") / limit) + 1;
      const sortBy = req.query.sort_by as string | undefined;
      const sortOrder = req.query.sort_order === "desc" ? "desc" : "asc";

      const result = await partsService.getParts(page, limit, search, sortBy, sortOrder);
      
      return res.status(200).json(result);
    } catch (error) {
      console.error("Get parts error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/parts/statistics", authenticate, async (_req, res) => {
    try {
      const stats = await partsService.getPartsStatistics();
      return res.status(200).json(stats);
    } catch (error) {
      console.error("Get parts statistics error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/parts/low-on-stock", authenticate, async (_req, res) => {
    try {
      const parts = await partsService.getLowStockParts();
      
      return res.status(200).json(parts);
    } catch (error) {
      console.error("Get low stock parts error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/parts/:id(\\d+)", authenticate, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de pièce invalide" });
      }
      
      const part = await partsService.getPartById(id);
      
      if (!part) {
        return res.status(404).json({ message: "Pièce non trouvée" });
      }
      
      return res.status(200).json(part);
    } catch (error) {
      console.error("Get part error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/parts", authenticate, isPartsCatalogManager, async (req, res) => {
    try {
      const parsedPart = insertPartSchema.parse(req.body);
      
      const part = await partsService.createPart(parsedPart, req.user?.id);
      
      return res.status(201).json(part);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Données de pièce invalides",
          errors: error.errors 
        });
      }
      
      console.error("Create part error:", error);
      return res.status(500).json({ 
        message: error instanceof Error ? error.message : "Erreur serveur" 
      });
    }
  });

  app.patch("/api/parts/:id(\\d+)", authenticate, isPartsCatalogManager, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de pièce invalide" });
      }

      if (req.body?.unit !== undefined) {
        const normalizedUnit = typeof req.body.unit === "string" ? req.body.unit.trim() : "";
        const isAllowedUnit = PART_UNITS.includes(normalizedUnit as (typeof PART_UNITS)[number]);
        if (!isAllowedUnit) {
          return res.status(400).json({
            message: "Unité invalide",
            allowedUnits: PART_UNITS,
          });
        }
        req.body.unit = normalizedUnit;
      }

      // Champs tenus par le serveur : jamais repris du corps (T4).
      const {
        id: _id,
        createdBy: _createdBy,
        createdAt: _createdAt,
        updatedBy: _updatedBy,
        updatedAt: _updatedAt,
        ...partPayload
      } = req.body ?? {};
      const { data, errors } = prepareColumnUpdate(parts, partPayload);
      if (errors.length > 0) {
        return next(new AppError(400, "Certaines informations de la pièce sont invalides.", { fieldErrors: errors }));
      }

      const updatedPart = await partsService.updatePart(id, data, req.user?.id);
      
      return res.status(200).json(updatedPart);
    } catch (error) {
      // Le service signale ces deux cas par message : les traduire en statut
      // plutôt que de renvoyer le texte de l'erreur au client.
      const message = error instanceof Error ? error.message : "";
      if (message === "Pièce non trouvée") {
        return next(new AppError(404, "Cette pièce n'existe plus.", { cause: error }));
      }
      if (message === "Une pièce avec cette référence existe déjà") {
        return next(new AppError(409, "Une pièce avec cette référence existe déjà.", { cause: error }));
      }
      log.error({ err: error, requestId: req.requestId }, "Update part error");
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.delete("/api/parts/:id(\\d+)", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de pièce invalide" });
      }
      
      await partsService.deletePart(id);
      
      return res.status(204).send();
    } catch (error) {
      console.error("Delete part error:", error);
      return res.status(500).json({ 
        message: error instanceof Error ? error.message : "Erreur serveur" 
      });
    }
  });

  // Parts Used Routes
  app.get("/api/parts-used", authenticate, async (req, res) => {
    try {
      const partsUsed = await storage.getAllPartsUsed();
      return res.status(200).json(partsUsed);
    } catch (error) {
      console.error("Get all parts used error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/work-orders/:workOrderId/parts", authenticate, async (req, res) => {
    try {
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (isNaN(workOrderId)) {
        return res.status(400).json({ message: "ID d'ordre de travail invalide" });
      }
      
      const partsUsed = await storage.getPartsUsedForWorkOrder(workOrderId);
      console.log(`Pièces récupérées pour l'ordre ${workOrderId}:`, JSON.stringify(partsUsed, null, 2));
      
      return res.status(200).json(partsUsed);
    } catch (error) {
      console.error("Get parts used error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // POST /api/work-orders/:workOrderId/parts : server/api/work-order-parts.routes.ts
  // (« Demander la pièce », le serveur décide entre sortie directe et demande).

  app.delete("/api/parts-used/:id", isTechnician, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de pièce utilisée invalide" });
      }
      
      await storage.removePartFromWorkOrder(id, req.user?.id);
      
      // Diffuser la mise à jour via WebSocket temps réel
      if ((global as any).broadcastUpdate) {
        (global as any).broadcastUpdate('part_used_removed', {
          partUsedId: id
        });
      }
      
      return res.status(204).send();
    } catch (error) {
      console.error("Remove part from work order error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/work-orders/:workOrderId/tire-rotations", authenticate, async (req, res) => {
    try {
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (isNaN(workOrderId)) {
        return res.status(400).json({ message: "ID d'ordre de travail invalide" });
      }
      
      const tireRotations = await storage.getTireRotationsForWorkOrder(workOrderId);
      
      return res.status(200).json(tireRotations);
    } catch (error) {
      console.error("Get tire rotations for work order error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Endpoint dédié pour les rapports d'inventaire
  app.get("/api/reports/inventory", authenticate, async (req, res) => {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
      
      console.log('Generating inventory report for period:', startDate, 'to', endDate);
      
      // Utiliser le storage existant pour éviter les erreurs d'importation
      const partsResult = await storage.getParts();
      const allParts = partsResult.parts || [];
      
      // Récupérer tous les mouvements via le storage
      const allMovements = await storage.getAllStockMovements();
      
      // Filtrer les mouvements par période
      const filteredMovements = allMovements.filter((movement: any) => {
        const movementDate = new Date(movement.createdAt || movement.date);
        return movementDate >= startDate && movementDate <= endDate;
      });
      
      console.log(`Found ${allParts.length} parts and ${filteredMovements.length} movements`);
      
      // Enrichir les données des pièces avec les mouvements
      const enrichedParts = allParts.map((part: any) => {
        const partMovements = filteredMovements.filter((movement: any) => movement.partId === part.id);
        const totalMovements = partMovements.reduce((sum: number, movement: any) => sum + Math.abs(movement.quantity || 0), 0);
        
        return {
          ...part,
          movementsCount: totalMovements,
          movements: partMovements
        };
      });
      
      const totalValue = allParts.reduce((sum: number, part: any) => sum + ((part.quantity || 0) * (part.unitPrice || 0)), 0);
      const lowStockParts = allParts.filter((part: any) => (part.quantity || 0) <= (part.minQuantity || 0));
      
      return res.status(200).json({
        parts: enrichedParts,
        movements: filteredMovements,
        statistics: {
          totalParts: allParts.length,
          totalValue,
          lowStockCount: lowStockParts.length,
          totalMovements: filteredMovements.length
        }
      });
    } catch (error) {
      console.error("Get inventory report error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Endpoint dédié pour les rapports de performance des techniciens
  app.get("/api/reports/technician-performance", authenticate, async (req, res) => {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
      
      console.log('Generating technician performance report for period:', startDate, 'to', endDate);
      
      // Utiliser le service de rapports pour obtenir les données
      const { reportsService } = await import("./services/reports-service");
      const reportData = await reportsService.getTechnicianPerformanceReportData(startDate, endDate);
      
      return res.status(200).json(reportData);
    } catch (error) {
      console.error("Get technician performance report error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // ====== ENDPOINTS D'EXPORT DE DONNÉES ======

  // Export des véhicules en XLSX
  app.get("/api/exports/vehicles", authenticate, async (req, res) => {
    try {
      console.log('Exporting vehicles data to XLSX...');
      const { exportService } = await import("./services/export-service");
      const xlsxBuffer = await exportService.exportVehiclesXLSX();
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=vehicules_${new Date().toISOString().split('T')[0]}.xlsx`);
      
      return res.send(xlsxBuffer);
    } catch (error) {
      console.error("Export vehicles error:", error);
      return res.status(500).json({ message: "Erreur lors de l'export des véhicules" });
    }
  });

  // Export des ordres de travail en XLSX
  app.get("/api/exports/work-orders", authenticate, async (req, res) => {
    try {
      console.log('Exporting work orders data to XLSX...');
      const { exportService } = await import("./services/export-service");
      const xlsxBuffer = await exportService.exportWorkOrdersXLSX();
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=ordres_travail_${new Date().toISOString().split('T')[0]}.xlsx`);
      
      return res.send(xlsxBuffer);
    } catch (error) {
      console.error("Export work orders error:", error);
      return res.status(500).json({ message: "Erreur lors de l'export des ordres de travail" });
    }
  });

  // Export de l'inventaire en XLSX
  app.get("/api/exports/inventory", authenticate, async (req, res) => {
    try {
      console.log('Exporting inventory data to XLSX...');
      const { exportService } = await import("./services/export-service");
      const xlsxBuffer = await exportService.exportInventoryXLSX();
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=inventaire_${new Date().toISOString().split('T')[0]}.xlsx`);
      
      return res.send(xlsxBuffer);
    } catch (error) {
      console.error("Export inventory error:", error);
      return res.status(500).json({ message: "Erreur lors de l'export de l'inventaire" });
    }
  });

  // Export des données de carburant en XLSX
  app.get("/api/exports/fuel", authenticate, async (req, res) => {
    try {
      console.log('Exporting fuel data to XLSX...');
      const { exportService } = await import("./services/export-service");
      const xlsxBuffer = await exportService.exportFuelXLSX();
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=carburant_${new Date().toISOString().split('T')[0]}.xlsx`);
      
      return res.send(xlsxBuffer);
    } catch (error) {
      console.error("Export fuel data error:", error);
      return res.status(500).json({ message: "Erreur lors de l'export des données de carburant" });
    }
  });

  // Export des utilisateurs en XLSX
  app.get("/api/exports/users", authenticate, async (req, res) => {
    try {
      console.log('Exporting users data to XLSX...');
      const { exportService } = await import("./services/export-service");
      const xlsxBuffer = await exportService.exportUsersXLSX();
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=utilisateurs_${new Date().toISOString().split('T')[0]}.xlsx`);
      
      return res.send(xlsxBuffer);
    } catch (error) {
      console.error("Export users error:", error);
      return res.status(500).json({ message: "Erreur lors de l'export des utilisateurs" });
    }
  });

  // Export complet de la base de données en ZIP
  app.get("/api/exports/complete", authenticate, async (req, res) => {
    try {
      console.log('Exporting complete database to ZIP...');
      const { exportService } = await import("./services/export-service");
      const zipBuffer = await exportService.exportCompleteDatabase();
      
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename=sauvegarde_complete_${new Date().toISOString().split('T')[0]}.zip`);
      
      return res.send(zipBuffer);
    } catch (error) {
      console.error("Export complete database error:", error);
      return res.status(500).json({ message: "Erreur lors de l'export complet de la base de données" });
    }
  });

  // Parts History and Analytics Routes
  app.get("/api/parts/stock-movements", authenticate, async (req, res) => {
    try {
      const partId = req.query.partId ? parseInt(req.query.partId as string) : undefined;
      
      if (partId && isNaN(partId)) {
        return res.status(400).json({ message: "ID de pièce invalide" });
      }
      
      if (partId) {
        // Get stock history for specific part
        const stockHistory = await storage.getPartStockHistory(partId);
        return res.status(200).json(stockHistory);
      } else {
        // Get all stock movements for all parts
        const allMovements = await storage.getAllStockMovements();
        return res.status(200).json(allMovements);
      }
    } catch (error) {
      console.error("Get stock movements error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/parts/:id/stock-history", authenticate, async (req, res) => {
    try {
      const partId = parseInt(req.params.id);
      
      if (isNaN(partId)) {
        return res.status(400).json({ message: "ID de pièce invalide" });
      }
      
      const stockHistory = await partsService.getStockHistory(partId);
      
      return res.status(200).json(stockHistory);
    } catch (error) {
      console.error("Get part stock history error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/parts/:id/work-orders", authenticate, async (req, res) => {
    try {
      const partId = parseInt(req.params.id);
      
      if (isNaN(partId)) {
        return res.status(400).json({ message: "ID de pièce invalide" });
      }
      
      const workOrders = await partsService.getWorkOrdersForPart(partId);
      
      return res.status(200).json(workOrders);
    } catch (error) {
      console.error("Get part work orders error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/parts/:id/usage-history", authenticate, async (req, res) => {
    try {
      const partId = parseInt(req.params.id);
      
      if (isNaN(partId)) {
        return res.status(400).json({ message: "ID de pièce invalide" });
      }
      
      const usageHistory = await partsService.getUsageHistory(partId);
      
      return res.status(200).json(usageHistory);
    } catch (error) {
      console.error("Get part usage history error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  const stockAdjustmentSchema = z.object({
    adjustment: z.coerce
      .number({ invalid_type_error: "L'ajustement doit être un nombre." })
      .int("L'ajustement doit être un nombre entier.")
      .refine((value) => value !== 0, "L'ajustement ne peut pas être nul."),
    reason: z
      .string({ required_error: "La raison de l'ajustement est obligatoire." })
      .trim()
      .min(1, "La raison de l'ajustement est obligatoire."),
  });

  app.post("/api/parts/:id/update-stock", authenticate, isInventoryManager, async (req, res, next) => {
    try {
      const partId = parseInt(req.params.id);

      if (isNaN(partId)) {
        return res.status(400).json({ message: "ID de pièce invalide" });
      }

      const { adjustment, reason } = stockAdjustmentSchema.parse(req.body);
      const updatedPart = await partsService.updateStock(partId, adjustment, reason, req.user?.id);

      return res.status(200).json(updatedPart);
    } catch (error) {
      // ZodError (400) et AppError (404, 409) : message métier et journalisation
      // par le gestionnaire central (ancien `console.error` migré là-bas).
      return next(error);
    }
  });

  app.get("/api/parts/:id/usage-history", authenticate, async (req, res) => {
    try {
      const partId = parseInt(req.params.id);
      
      if (isNaN(partId)) {
        return res.status(400).json({ message: "ID de pièce invalide" });
      }
      
      const usageHistory = await storage.getPartUsageHistory(partId);
      
      return res.status(200).json(usageHistory);
    } catch (error) {
      console.error("Get part usage history error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // === WAREHOUSE & STOCK ALERTS ROUTES (Sprint 1 - Phase 2) ===
  
  // Valeur totale de l'inventaire (94,4M FCFA de pièces)
  app.get("/api/warehouse/inventory-value", authenticate, async (_req, res) => {
    try {
      const { stockAlertsService } = await import("./services/stock-alerts-service");
      const inventoryValue = await stockAlertsService.getInventoryValue();
      return res.status(200).json(inventoryValue);
    } catch (error) {
      console.error("Get inventory value error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Alertes de réapprovisionnement actives (38 alertes)
  app.get("/api/warehouse/reorder-alerts", authenticate, async (_req, res) => {
    try {
      const { stockAlertsService } = await import("./services/stock-alerts-service");
      const alerts = await stockAlertsService.getReorderAlerts();
      return res.status(200).json(alerts);
    } catch (error) {
      console.error("Get reorder alerts error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Stock réel d'une pièce avec historique mouvements
  app.get("/api/parts/:id/real-stock", authenticate, async (req, res) => {
    try {
      const partId = parseInt(req.params.id);
      
      if (isNaN(partId)) {
        return res.status(400).json({ message: "ID de pièce invalide" });
      }
      
      const { stockAlertsService } = await import("./services/stock-alerts-service");
      const realStock = await stockAlertsService.getRealStock(partId);
      
      return res.status(200).json(realStock);
    } catch (error) {
      console.error("Get real stock error:", error);
      return res.status(500).json({ 
        message: error instanceof Error ? error.message : "Erreur serveur" 
      });
    }
  });
  
  // Enregistrer un mouvement de stock (ENTRÉE/SORTIE)
  app.post("/api/warehouse/stock-movement", authenticate, isInventoryManager, async (req, res) => {
    try {
      const { partId, type, quantity, reason, workOrderId, responsiblePerson, deliveryReceiptNumber } = req.body;
      
      if (!partId || !type || !quantity || !reason) {
        return res.status(400).json({ message: "Données incomplètes" });
      }
      
      if (!['in', 'out'].includes(type)) {
        return res.status(400).json({ message: "Type de mouvement invalide (in/out)" });
      }

      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Non authentifié" });
      }
      
      const { stockAlertsService } = await import("./services/stock-alerts-service");
      const movement = await stockAlertsService.recordStockMovement({
        partId: parseInt(partId),
        type: type as 'in' | 'out',
        quantity: parseFloat(quantity),
        reason,
        workOrderId: workOrderId ? parseInt(workOrderId) : undefined,
        responsiblePerson,
        deliveryReceiptNumber,
        userId
      });
      
      return res.status(201).json(movement);
    } catch (error) {
      console.error("Record stock movement error:", error);
      return res.status(500).json({ 
        message: error instanceof Error ? error.message : "Erreur serveur" 
      });
    }
  });
  
  // Pièces les plus utilisées (top N)
  app.get("/api/warehouse/most-used-parts", authenticate, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      
      const { stockAlertsService } = await import("./services/stock-alerts-service");
      const mostUsedParts = await stockAlertsService.getMostUsedParts(limit);
      
      return res.status(200).json(mostUsedParts);
    } catch (error) {
      console.error("Get most used parts error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Top parts consumed - formatted for chart
  app.get("/api/warehouse/top-consumed-parts", authenticate, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      
      const { stockAlertsService } = await import("./services/stock-alerts-service");
      const mostUsedParts = await stockAlertsService.getMostUsedParts(limit);
      
      // Format data for the chart component
      const formattedData = mostUsedParts.map(part => ({
        partName: part.name,
        quantity: part.totalUsed,
        totalValue: part.totalValue
      }));
      
      return res.status(200).json(formattedData);
    } catch (error) {
      console.error("Get top consumed parts error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Stock value history - for historical chart
  app.get("/api/warehouse/stock-value-history", authenticate, async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;

      const { stockAlertsService } = await import("./services/stock-alerts-service");
      const history = await stockAlertsService.getStockValueHistory(days);

      return res.status(200).json(history);
    } catch (error) {
      console.error("Get stock value history error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Statistiques globales du magasin
  app.get("/api/warehouse/statistics", authenticate, async (_req, res) => {
    try {
      const { stockAlertsService } = await import("./services/stock-alerts-service");
      const statistics = await stockAlertsService.getWarehouseStatistics();
      
      return res.status(200).json(statistics);
    } catch (error) {
      console.error("Get warehouse statistics error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Pièces par fournisseur avec valeur totale
  app.get("/api/warehouse/parts-by-supplier", authenticate, async (_req, res) => {
    try {
      const { stockAlertsService } = await import("./services/stock-alerts-service");
      const partsBySupplier = await stockAlertsService.getPartsBySupplier();
      
      return res.status(200).json(partsBySupplier);
    } catch (error) {
      console.error("Get parts by supplier error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Fuel Records Routes
  app.get("/api/fuel-records/vehicle/:vehicleId", authenticate, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId);
      
      if (isNaN(vehicleId)) {
        return res.status(400).json({ message: "ID de véhicule invalide" });
      }
      
      // Récupérer les enregistrements de carburant depuis le service
      const fuelRecords = await fuelService.getFuelRecordsByVehicleId(vehicleId);
      
      // Enrichir les données avec le prix par litre calculé
      const enrichedFuelRecords = fuelRecords.map((record: any) => ({
        ...record,
        pricePerLiter: record.quantity > 0 ? Number(record.cost) / record.quantity : 0,
        totalCost: Number(record.cost)
      }));
      
      return res.status(200).json(enrichedFuelRecords);
    } catch (error) {
      console.error("Get fuel records error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Nombre saisi dans un formulaire : "12" accepté, "12abc" refusé (parseFloat
  // le tronquait en 12, et "abc" donnait NaN, stocké tel quel en colonne real).
  const formNumber = (schema: z.ZodNumber) =>
    z.preprocess((value) => {
      if (value === null || (typeof value === "string" && value.trim() === "")) return undefined;
      return typeof value === "string" ? Number(value) : value;
    }, schema);

  const fuelRecordBodySchema = z.object({
    vehicleId: formNumber(z.number().int().positive()),
    date: z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "Doit être une date valide." }),
    quantity: formNumber(z.number().positive()),
    cost: formNumber(z.number().min(0)),
    mileage: formNumber(z.number().int().min(0)),
    fullTank: z.boolean().optional(),
    notes: z.string().nullable().optional(),
  });

  app.post("/api/fuel-records", isFuelRecordWriter, async (req, res, next) => {
    try {
      const input = fuelRecordBodySchema.parse(req.body);
      // Convertir les données du formulaire au format InsertFuelRecord
      const fuelRecordData = {
        vehicleId: input.vehicleId,
        date: input.date,
        quantity: input.quantity,
        cost: input.cost.toString(), // Convertir en string pour numeric
        mileage: input.mileage,
        fullTank: input.fullTank !== undefined ? input.fullTank : true,
        notes: input.notes || null
      };

      log.info({ requestId: req.requestId, fuelRecordData }, "Creating fuel record with data");
      
      // Créer l'enregistrement de carburant via le service
      const fuelRecord = await fuelService.createFuelRecord(fuelRecordData, req.session.userId);
      
      if (!fuelRecord) {
        return res.status(500).json({ message: "Erreur lors de la création de l'enregistrement" });
      }
      
      // Mettre à jour automatiquement le kilométrage via le service de kilométrage
      await mileageService.updateVehicleMileage(
        fuelRecordData.vehicleId, 
        fuelRecordData.mileage, 
        'fuel', 
        fuelRecord.id, 
        req.session.userId
      );

      // Vérifier et déclencher les maintenances basées sur le kilométrage
      try {
        const generatedWorkOrders = await preventiveMaintenanceService.checkMileageBasedMaintenance(
          fuelRecordData.vehicleId,
          fuelRecordData.mileage
        );
        
        if (generatedWorkOrders.length > 0) {
          log.info({ requestId: req.requestId, count: generatedWorkOrders.length }, "Ordres de travail générés automatiquement pour maintenance kilométrique");
        }
      } catch (error) {
        log.error({ err: error, requestId: req.requestId }, "Erreur lors de la vérification des maintenances kilométriques");
      }

      return res.status(201).json(fuelRecord);
    } catch (error) {
      if (error instanceof z.ZodError) return next(error);
      log.error({ err: error, requestId: req.requestId }, "Create fuel record error");
      return res.status(500).json({ message: "Erreur lors de l'enregistrement du plein" });
    }
  });

  app.patch("/api/fuel-records/:id", isFuelRecordWriter, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID d'enregistrement de carburant invalide" });
      }
      
      const fuelRecord = await fuelService.getFuelRecord(id);
      
      if (!fuelRecord) {
        return res.status(404).json({ message: "Enregistrement de carburant non trouvé" });
      }

      // Même règle que l'écran (canEditFuelRecord) : l'admin, ou l'auteur du plein.
      if (req.user?.role !== "admin" && fuelRecord.createdBy !== req.session.userId) {
        return next(new AppError(403, "Seul l'auteur du plein ou un administrateur peut le modifier."));
      }
      
      // Convertir les données du formulaire au bon format ; champ absent = inchangé
      const input = fuelRecordBodySchema.partial().parse(req.body ?? {});
      const updateData = {
        vehicleId: input.vehicleId ?? fuelRecord.vehicleId,
        date: input.date ?? fuelRecord.date,
        quantity: input.quantity ?? fuelRecord.quantity,
        cost: input.cost !== undefined ? input.cost.toString() : fuelRecord.cost,
        mileage: input.mileage ?? fuelRecord.mileage,
        fullTank: input.fullTank !== undefined ? input.fullTank : fuelRecord.fullTank,
        notes: input.notes !== undefined ? input.notes : fuelRecord.notes
      };
      
      log.info({ requestId: req.requestId, fuelRecordId: id, updateData }, "Updating fuel record with data");
      
      // Utiliser le service fuel-service au lieu de storage direct
      const updatedFuelRecord = await fuelService.updateFuelRecord(id, updateData, req.session.userId);
      
      if (!updatedFuelRecord) {
        return res.status(500).json({ message: "Erreur lors de la mise à jour de l'enregistrement" });
      }
      
      // Mettre à jour le kilométrage du véhicule si nécessaire via le service de kilométrage
      const previousMileage = fuelRecord.mileage ?? 0;
      if (
        typeof updateData.mileage === "number" &&
        typeof updateData.vehicleId === "number" &&
        updateData.mileage > previousMileage
      ) {
        const nextMileage = updateData.mileage;
        const nextVehicleId = updateData.vehicleId;

        await mileageService.updateVehicleMileage(
          nextVehicleId,
          nextMileage,
          'fuel',
          id,
          req.session.userId
        );

        // Vérifier et déclencher les maintenances basées sur le kilométrage
        try {
          const generatedWorkOrders = await preventiveMaintenanceService.checkMileageBasedMaintenance(
            nextVehicleId,
            nextMileage
          );
          
          if (generatedWorkOrders.length > 0) {
            log.info({ requestId: req.requestId, count: generatedWorkOrders.length }, "Ordres de travail générés automatiquement pour maintenance kilométrique");
          }
        } catch (error) {
          log.error({ err: error, requestId: req.requestId }, "Erreur lors de la vérification des maintenances kilométriques");
        }
      }

      return res.status(200).json(updatedFuelRecord);
    } catch (error) {
      if (error instanceof z.ZodError) return next(error);
      log.error({ err: error, requestId: req.requestId }, "Update fuel record error");
      return res.status(500).json({ message: "Erreur lors de la mise à jour du plein" });
    }
  });

  app.delete("/api/fuel-records/:id", isWorkshopManager, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID d'enregistrement de carburant invalide" });
      }
      
      const fuelRecord = await fuelService.getFuelRecord(id);
      
      if (!fuelRecord) {
        return res.status(404).json({ message: "Enregistrement de carburant non trouvé" });
      }
      
      await fuelService.deleteFuelRecord(id);
      
      return res.status(204).send();
    } catch (error) {
      console.error("Delete fuel record error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Récupérer tous les enregistrements de carburant
  app.get("/api/fuel-records", authenticate, async (req, res) => {
    try {
      const vehicleId = req.query.vehicleId ? parseInt(req.query.vehicleId as string) : undefined;
      let fuelRecords: Awaited<ReturnType<typeof storage.getFuelRecordsByVehicleId>> = [];
      
      if (vehicleId && !isNaN(vehicleId)) {
        fuelRecords = await storage.getFuelRecordsByVehicleId(vehicleId);
      } else {
        // Récupérer tous les enregistrements de carburant
        // Note: Dans une application réelle, il faudrait paginer les résultats
        const vehicles = await storage.getVehicles();
        
        // Pour chaque véhicule, récupérer ses enregistrements de carburant
        for (const vehicle of vehicles.vehicles) {
          const records = await storage.getFuelRecordsByVehicleId(vehicle.id);
          fuelRecords = [...fuelRecords, ...records];
        }
        
        // Trier par date (plus récent en premier)
        fuelRecords.sort((a, b) => {
          const bTime = b.date ? new Date(b.date).getTime() : 0;
          const aTime = a.date ? new Date(a.date).getTime() : 0;
          return bTime - aTime;
        });
      }
      
      // Enrichir les données avec le prix par litre calculé
      const enrichedFuelRecords = fuelRecords.map((record) => ({
        ...record,
        pricePerLiter: record.quantity > 0 ? Number(record.cost ?? 0) / record.quantity : 0,
        totalCost: Number(record.cost ?? 0)
      }));
      
      return res.status(200).json(enrichedFuelRecords);
    } catch (error) {
      console.error("Get all fuel records error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Statistiques de consommation de carburant
  // Routes pour la gestion du kilométrage
  app.get("/api/vehicles/:id/mileage", authenticate, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.id);
      const currentMileage = await mileageService.getCurrentMileage(vehicleId);
      
      return res.json({ 
        vehicleId, 
        currentMileage,
        lastMileage: currentMileage 
      });
    } catch (error) {
      console.error("Get vehicle mileage error:", error);
      return res.status(500).json({ message: "Erreur lors de la récupération du kilométrage" });
    }
  });

  app.get("/api/vehicles/:id/mileage/history", authenticate, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.id);
      const limit = parseInt(req.query.limit as string) || 50;
      
      const history = await mileageService.getMileageHistory(vehicleId, limit);
      
      return res.json(history);
    } catch (error) {
      console.error("Get mileage history error:", error);
      return res.status(500).json({ message: "Erreur lors de la récupération de l'historique" });
    }
  });

  app.post("/api/vehicles/:id/mileage/sync", authenticate, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.id);
      
      const updatedVehicle = await mileageService.synchronizeVehicleMileage(vehicleId);
      
      if (!updatedVehicle) {
        return res.status(404).json({ message: "Véhicule non trouvé ou aucune synchronisation nécessaire" });
      }
      
      return res.json({
        message: "Kilométrage synchronisé avec succès",
        vehicle: updatedVehicle
      });
    } catch (error) {
      console.error("Sync vehicle mileage error:", error);
      return res.status(500).json({ message: "Erreur lors de la synchronisation du kilométrage" });
    }
  });

  app.get("/api/fuel-records/statistics", authenticate, async (req, res) => {
    try {
      const period = req.query.period as string || 'month';
      
      // Récupérer tous les véhicules
      const vehicles = await storage.getVehicles();
      console.log('Vehicles retrieved for fuel stats:', vehicles);
      
      let totalFuel = 0;
      let totalCost = 0;
      let vehicleStats: any[] = [];
      
      // Date limite pour la période
      const now = new Date();
      let limitDate = new Date();
      
      switch (period) {
        case 'week':
          limitDate.setDate(now.getDate() - 7);
          break;
        case 'month':
          limitDate.setMonth(now.getMonth() - 1);
          break;
        case 'quarter':
          limitDate.setMonth(now.getMonth() - 3);
          break;
        case 'year':
          limitDate.setFullYear(now.getFullYear() - 1);
          break;
        default:
          limitDate.setMonth(now.getMonth() - 1); // Par défaut: 1 mois
      }
      
      // Pour chaque véhicule, calculer les statistiques
      for (const vehicle of vehicles.vehicles) {
        const records = await storage.getFuelRecordsByVehicleId(vehicle.id);
        
        // Filtrer les enregistrements selon la période
        const filteredRecords = records.filter(
          (record): record is typeof record & { date: string } =>
            typeof record.date === "string" && new Date(record.date) >= limitDate
        );
        
        if (filteredRecords.length > 0) {
          // Trier par date (plus ancien en premier)
          const sortedRecords = filteredRecords.sort((a, b) => 
            new Date(a.date).getTime() - new Date(b.date).getTime()
          );
          
          const vehicleFuel = filteredRecords.reduce((sum, record) => sum + record.quantity, 0);
          const vehicleCost = filteredRecords.reduce((sum, record) => sum + Number(record.cost ?? 0), 0);
          
          // Calculer la distance parcourue (entre premier et dernier enregistrement)
          const firstRecord = sortedRecords[0];
          const lastRecord = sortedRecords[sortedRecords.length - 1];
          const distance = (lastRecord.mileage ?? 0) - (firstRecord.mileage ?? 0);
          
          // Calculer la consommation moyenne
          const avgConsumption = distance > 0 ? (vehicleFuel * 100) / distance : 0;
          
          vehicleStats.push({
            vehicleId: vehicle.id,
            registrationNumber: vehicle.registrationNumber,
            brand: vehicle.brand,
            model: vehicle.model,
            fuel: vehicleFuel,
            cost: vehicleCost,
            distance: distance,
            avgConsumption: avgConsumption,
            recordCount: filteredRecords.length,
          });
          
          totalFuel += vehicleFuel;
          totalCost += vehicleCost;
        }
      }
      
      return res.status(200).json({
        period,
        totalFuel,
        totalCost,
        vehicleStats,
      });
    } catch (error) {
      console.error("Get fuel statistics error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Historique de consommation pour le graphique
  app.get("/api/fuel-records/consumption-history", authenticate, async (req, res) => {
    try {
      const period = req.query.period as string || 'month';
      const vehicleId = req.query.vehicleId ? parseInt(req.query.vehicleId as string) : undefined;
      
      // Date limite pour la période
      const now = new Date();
      let limitDate = new Date();
      let periodFormat: 'day' | 'month' = 'day';
      
      switch (period) {
        case 'week':
          limitDate.setDate(now.getDate() - 7);
          periodFormat = 'day';
          break;
        case 'month':
          limitDate.setMonth(now.getMonth() - 1);
          periodFormat = 'day';
          break;
        case 'quarter':
          limitDate.setMonth(now.getMonth() - 3);
          periodFormat = 'month';
          break;
        case 'year':
          limitDate.setFullYear(now.getFullYear() - 1);
          periodFormat = 'month';
          break;
        default:
          limitDate.setMonth(now.getMonth() - 1);
          periodFormat = 'day';
      }
      
      // Récupérer les enregistrements de carburant
      type FuelRecordWithDate = Awaited<ReturnType<typeof storage.getFuelRecordsByVehicleId>>[number] & { date: string };
      let allRecords: FuelRecordWithDate[] = [];
      
      if (vehicleId && !isNaN(vehicleId)) {
        const records = await storage.getFuelRecordsByVehicleId(vehicleId);
        allRecords = records.filter(
          (record): record is FuelRecordWithDate =>
            typeof record.date === "string" && new Date(record.date) >= limitDate
        );
      } else {
        // Récupérer pour tous les véhicules
        const vehicles = await storage.getVehicles();
        
        for (const vehicle of vehicles.vehicles) {
          const records = await storage.getFuelRecordsByVehicleId(vehicle.id);
          const filteredRecords = records.filter(
            (record): record is FuelRecordWithDate =>
              typeof record.date === "string" && new Date(record.date) >= limitDate
          );
          allRecords = [...allRecords, ...filteredRecords];
        }
      }
      
      // Grouper par période (jour ou mois)
      const historyData: Record<string, { date: string, quantity: number, cost: number, count: number }> = {};
      
      allRecords.forEach(record => {
        const recordDate = new Date(record.date);
        let periodKey: string;
        
        if (periodFormat === 'day') {
          periodKey = `${recordDate.getFullYear()}-${String(recordDate.getMonth() + 1).padStart(2, '0')}-${String(recordDate.getDate()).padStart(2, '0')}`;
        } else {
          periodKey = `${recordDate.getFullYear()}-${String(recordDate.getMonth() + 1).padStart(2, '0')}`;
        }
        
        if (!historyData[periodKey]) {
          historyData[periodKey] = {
            date: periodKey,
            quantity: 0,
            cost: 0,
            count: 0
          };
        }
        
        historyData[periodKey].quantity += record.quantity;
        historyData[periodKey].cost += Number(record.cost ?? 0);
        historyData[periodKey].count += 1;
      });
      
      // Convertir en tableau et trier par date
      const result = Object.values(historyData).sort((a, b) => a.date.localeCompare(b.date));
      
      return res.status(200).json(result);
    } catch (error) {
      console.error("Get fuel consumption history error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // === FUEL CARD SERVICE ROUTES (Sprint 1 - Phase 2) ===
  
  // Solde actuel de la carte carburant (14,1M FCFA disponibles)
  app.get("/api/fuel-card/balance", authenticate, async (_req, res) => {
    try {
      const { fuelCardService } = await import("./services/fuel-card-service");
      const balance = await fuelCardService.getCurrentBalance();
      return res.status(200).json(balance);
    } catch (error) {
      console.error("Get fuel card balance error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Recharger la carte carburant (crédit)
  app.post("/api/fuel-card/recharge", isFuelCardManager, async (req, res) => {
    try {
      const { amount, quantity, unitPrice, priceSource, date, paymentMode, orderNumber, notes } = req.body;

      const amountValue = Number.parseFloat(String(amount));
      const quantityValue = quantity !== undefined && quantity !== null
        ? Number.parseFloat(String(quantity))
        : NaN;
      const unitPriceValue = unitPrice !== undefined && unitPrice !== null
        ? Number.parseFloat(String(unitPrice))
        : NaN;
      const hasQuantity = Number.isFinite(quantityValue) && quantityValue > 0;
      const hasUnitPrice = Number.isFinite(unitPriceValue) && unitPriceValue > 0;

      if (!Number.isFinite(amountValue) || amountValue <= 0 || !date || !paymentMode || (!hasQuantity && !hasUnitPrice)) {
        return res.status(400).json({ message: "Données de recharge incomplètes" });
      }

      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Non authentifié" });
      }

      const resolvedQuantity = hasQuantity
        ? quantityValue
        : amountValue / unitPriceValue;
      const resolvedUnitPrice = hasUnitPrice
        ? unitPriceValue
        : amountValue / quantityValue;
      
      const { fuelCardService } = await import("./services/fuel-card-service");
      const result = await fuelCardService.rechargeCard({
        amount: amountValue,
        quantity: resolvedQuantity,
        unitPrice: resolvedUnitPrice,
        priceSource:
          priceSource === "real" || priceSource === "fallback" || priceSource === "manual"
            ? priceSource
            : undefined,
        date,
        paymentMode,
        orderNumber,
        notes,
        userId
      });

      if ((global as any).broadcastUpdate) {
        (global as any).broadcastUpdate("fuel_card_recharged", {
          version: 1,
          entity: "fuel_card",
          entityId: typeof result?.recharge?.id === "number" ? result.recharge.id : null,
          payload: {
            recharge: result,
          },
          scope: { type: "broadcast" },
          actor: {
            userId: req.session.userId ?? null,
            role: req.session.role ?? null,
          },
          emittedAt: new Date().toISOString(),
        });
      }
      
      return res.status(201).json(result);
    } catch (error) {
      console.error("Fuel card recharge error:", error);
      return res.status(500).json({ 
        message: error instanceof Error ? error.message : "Erreur serveur" 
      });
    }
  });
  
  // Enregistrer une consommation de carburant (débit)
  app.post("/api/fuel-card/consumption", authenticate, async (req, res) => {
    try {
      const { vehicleId, quantity, unitPrice, date, stationName, destination, clientName, notes } = req.body;
      
      if (!vehicleId || !quantity || !unitPrice || !date || !stationName || !destination) {
        return res.status(400).json({ message: "Données de consommation incomplètes" });
      }

      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Non authentifié" });
      }
      
      const { fuelCardService } = await import("./services/fuel-card-service");
      const result = await fuelCardService.recordConsumption({
        vehicleId: parseInt(vehicleId),
        quantity: parseFloat(quantity),
        unitPrice: parseFloat(unitPrice),
        date,
        stationName,
        destination,
        clientName,
        notes,
        userId
      });
      
      return res.status(201).json(result);
    } catch (error) {
      console.error("Record fuel consumption error:", error);
      return res.status(500).json({ 
        message: error instanceof Error ? error.message : "Erreur serveur" 
      });
    }
  });
  
  // Historique carburant avec filtres (année, mois, véhicule, type)
  app.get("/api/fuel-card/history", authenticate, async (req, res) => {
    try {
      const { year, month, vehicleId, type } = req.query;
      
      const filters: any = {};
      
      if (year) filters.year = parseInt(year as string);
      if (month) filters.month = parseInt(month as string);
      if (vehicleId) filters.vehicleId = parseInt(vehicleId as string);
      if (type && ['credit', 'debit', 'all'].includes(type as string)) {
        filters.type = type as 'credit' | 'debit' | 'all';
      }
      
      const { fuelCardService } = await import("./services/fuel-card-service");
      const history = await fuelCardService.getFuelHistory(filters);
      
      return res.status(200).json(history);
    } catch (error) {
      console.error("Get fuel history error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Statistiques de consommation par véhicule
  app.get("/api/fuel-card/vehicle/:vehicleId/stats", authenticate, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId);
      
      if (isNaN(vehicleId)) {
        return res.status(400).json({ message: "ID de véhicule invalide" });
      }
      
      const { fuelCardService } = await import("./services/fuel-card-service");
      const stats = await fuelCardService.getConsumptionStatsByVehicle(vehicleId);
      
      return res.status(200).json(stats);
    } catch (error) {
      console.error("Get vehicle fuel stats error:", error);
      return res.status(500).json({ 
        message: error instanceof Error ? error.message : "Erreur serveur" 
      });
    }
  });
  
  // Détection d'anomalies de consommation
  app.get("/api/fuel-card/vehicle/:vehicleId/anomalies", authenticate, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId);
      
      if (isNaN(vehicleId)) {
        return res.status(400).json({ message: "ID de véhicule invalide" });
      }
      
      const { fuelCardService } = await import("./services/fuel-card-service");
      const anomalies = await fuelCardService.detectAnomalies(vehicleId);
      
      return res.status(200).json(anomalies);
    } catch (error) {
      console.error("Detect fuel anomalies error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Statistiques par client (MAERSK, CNPCC, etc.)
  app.get("/api/fuel-card/stats-by-client", authenticate, async (_req, res) => {
    try {
      const { fuelCardService } = await import("./services/fuel-card-service");
      const stats = await fuelCardService.getStatsByClient();
      
      return res.status(200).json(stats);
    } catch (error) {
      console.error("Get fuel stats by client error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Statistiques mensuelles
  app.get("/api/fuel-card/monthly-stats", authenticate, async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
      
      const { fuelCardService } = await import("./services/fuel-card-service");
      const stats = await fuelCardService.getMonthlyStats(year, month);
      
      return res.status(200).json(stats);
    } catch (error) {
      console.error("Get monthly fuel stats error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // === VAT & BILLING SERVICE ROUTES (Sprint 1 - Phase 2) ===
  
  // Synthèse complète fournisseurs avec factures (96 factures)
  app.get("/api/suppliers/summary", authenticate, async (_req, res) => {
    try {
      const { vatBillingService } = await import("./services/vat-billing-service");
      const summary = await vatBillingService.getSuppliersSummary();
      return res.status(200).json(summary);
    } catch (error) {
      console.error("Get suppliers summary error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Statistiques par famille de produits
  app.get("/api/invoices/by-family", authenticate, async (_req, res) => {
    try {
      const { vatBillingService } = await import("./services/vat-billing-service");
      const stats = await vatBillingService.getInvoicesByFamily();
      return res.status(200).json(stats);
    } catch (error) {
      console.error("Get invoices by family error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Factures d'un fournisseur avec suivi paiements
  app.get("/api/suppliers/:id/invoices/payment", authenticate, async (req, res) => {
    try {
      const supplierId = parseInt(req.params.id);
      
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "ID fournisseur invalide" });
      }
      
      const { vatBillingService } = await import("./services/vat-billing-service");
      const result = await vatBillingService.getSupplierInvoicesWithPayments(supplierId);
      
      return res.status(200).json(result);
    } catch (error) {
      console.error("Get supplier invoices with payments error:", error);
      return res.status(500).json({ 
        message: error instanceof Error ? error.message : "Erreur serveur" 
      });
    }
  });
  
  // Calculer TVA pour un montant HT
  app.post("/api/invoices/calculate-vat", authenticate, async (req, res) => {
    try {
      const { amountHT } = req.body;
      
      if (!amountHT || isNaN(parseFloat(amountHT))) {
        return res.status(400).json({ message: "Montant HT invalide" });
      }
      
      const { vatBillingService } = await import("./services/vat-billing-service");
      const result = vatBillingService.calculateVAT(parseFloat(amountHT));
      
      return res.status(200).json(result);
    } catch (error) {
      console.error("Calculate VAT error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Pièces extraites d'une facture
  app.get("/api/invoices/:id/parts", authenticate, async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      
      if (isNaN(invoiceId)) {
        return res.status(400).json({ message: "ID facture invalide" });
      }
      
      const { vatBillingService } = await import("./services/vat-billing-service");
      const result = await vatBillingService.getPartsFromInvoice(invoiceId);
      
      return res.status(200).json(result);
    } catch (error) {
      console.error("Get parts from invoice error:", error);
      return res.status(500).json({ 
        message: error instanceof Error ? error.message : "Erreur serveur" 
      });
    }
  });
  
  // Statistiques TVA mensuelles
  app.get("/api/invoices/monthly-vat-stats", authenticate, async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
      
      const { vatBillingService } = await import("./services/vat-billing-service");
      const stats = await vatBillingService.getMonthlyVATStats(year, month);
      
      return res.status(200).json(stats);
    } catch (error) {
      console.error("Get monthly VAT stats error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Top fournisseurs par montant
  app.get("/api/suppliers/top", authenticate, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      
      const { vatBillingService } = await import("./services/vat-billing-service");
      const topSuppliers = await vatBillingService.getTopSuppliers(limit);
      
      return res.status(200).json(topSuppliers);
    } catch (error) {
      console.error("Get top suppliers error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Système d'alertes pour les entretiens et documents
  app.get("/api/vehicles/check-alerts", authenticate, async (req, res) => {
    try {
      const vehicles = await storage.getVehicles();
      const alerts: any[] = [];
      const now = new Date();
      
      // Pour chaque véhicule, vérifier les dates d'expiration
      for (const vehicle of vehicles.vehicles) {
        // Vérifier la date du prochain entretien
        if (vehicle.nextMaintenanceDate) {
          const maintenanceDate = new Date(vehicle.nextMaintenanceDate);
          const daysDiff = Math.ceil((maintenanceDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          
          if (daysDiff <= 0) {
            alerts.push({
              vehicleId: vehicle.id,
              registrationNumber: vehicle.registrationNumber,
              type: 'maintenance_overdue',
              message: `L'entretien du véhicule ${vehicle.registrationNumber} est en retard de ${Math.abs(daysDiff)} jours.`,
              priority: 'high',
            });
          } else if (daysDiff <= 7) {
            alerts.push({
              vehicleId: vehicle.id,
              registrationNumber: vehicle.registrationNumber,
              type: 'maintenance_due',
              message: `L'entretien du véhicule ${vehicle.registrationNumber} doit être effectué dans ${daysDiff} jours.`,
              priority: 'medium',
            });
          }
        }
        
        // Vérifier le kilométrage pour l'entretien
        if (vehicle.nextMaintenanceMileage && vehicle.mileage) {
          const mileageDiff = vehicle.nextMaintenanceMileage - vehicle.mileage;
          
          if (mileageDiff <= 0) {
            alerts.push({
              vehicleId: vehicle.id,
              registrationNumber: vehicle.registrationNumber,
              type: 'maintenance_mileage_exceeded',
              message: `Le kilométrage du véhicule ${vehicle.registrationNumber} a dépassé la limite pour l'entretien de ${Math.abs(mileageDiff)} km.`,
              priority: 'high',
            });
          } else if (mileageDiff <= 500) {
            alerts.push({
              vehicleId: vehicle.id,
              registrationNumber: vehicle.registrationNumber,
              type: 'maintenance_mileage_approaching',
              message: `Le kilométrage du véhicule ${vehicle.registrationNumber} approche la limite pour l'entretien (${mileageDiff} km restants).`,
              priority: 'medium',
            });
          }
        }
        
        // Vérifier les dates d'expiration des documents
        const documents = await storage.getVehicleDocuments(vehicle.id);
        
        for (const doc of documents) {
          if (doc.expiryDate) {
            const expiryDate = new Date(doc.expiryDate);
            const daysDiff = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            
            let documentType = '';
            switch (doc.type) {
              case 'carte_grise':
                documentType = 'Carte grise';
                break;
              case 'assurance':
                documentType = 'Assurance';
                break;
              case 'visite_technique':
                documentType = 'Visite technique';
                break;
              case 'taxe':
                documentType = 'Taxe';
                break;
              default:
                documentType = doc.name;
            }
            
            if (daysDiff <= 0) {
              alerts.push({
                vehicleId: vehicle.id,
                registrationNumber: vehicle.registrationNumber,
                documentId: doc.id,
                type: 'document_expired',
                message: `Le document "${documentType}" du véhicule ${vehicle.registrationNumber} est expiré depuis ${Math.abs(daysDiff)} jours.`,
                priority: 'critical',
              });
            } else if (daysDiff <= 30) {
              alerts.push({
                vehicleId: vehicle.id,
                registrationNumber: vehicle.registrationNumber,
                documentId: doc.id,
                type: 'document_expiring',
                message: `Le document "${documentType}" du véhicule ${vehicle.registrationNumber} expire dans ${daysDiff} jours.`,
                priority: daysDiff <= 7 ? 'high' : 'medium',
              });
            }
          }
        }
      }
      
      return res.status(200).json(alerts);
    } catch (error) {
      console.error("Check vehicle alerts error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Alert Routes
  app.get("/api/alerts", authenticate, async (req: Request, res) => {
    try {
      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Utilisateur non authentifié" });
      }
      
      const alerts = await storage.getAlertsByUserId(userId);
      
      return res.status(200).json(alerts);
    } catch (error) {
      console.error("Get alerts error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/alerts/unread", authenticate, async (req: Request, res) => {
    try {
      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Utilisateur non authentifié" });
      }
      
      const alerts = await storage.getUnreadAlertsByUserId(userId);
      
      return res.status(200).json(alerts);
    } catch (error) {
      console.error("Get unread alerts error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/alerts/active", authenticate, async (req: Request, res) => {
    try {
      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Utilisateur non authentifié" });
      }

      const alerts = await storage.getUnreadAlertsByUserId(userId);
      return res.status(200).json(alerts);
    } catch (error) {
      console.error("Get active alerts error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/alerts/type/:type", authenticate, async (req: Request, res) => {
    try {
      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Utilisateur non authentifié" });
      }

      const requestedType = String(req.params.type || "").toLowerCase();
      const alerts = await storage.getAlertsByUserId(userId);

      const normalizeAlertType = (type: string) => {
        if (type === "inventory") return "stock";
        return type;
      };

      const filteredAlerts = alerts.filter((alert) => {
        const normalizedType = normalizeAlertType(alert.type);
        return normalizedType === requestedType;
      });

      return res.status(200).json(filteredAlerts);
    } catch (error) {
      console.error("Get alerts by type error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/alerts/count", authenticate, async (req: Request, res) => {
    try {
      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Utilisateur non authentifié" });
      }

      const user = await storage.getUser(userId);
      const shouldIncludeStockReorderCount = [
        "admin",
        "warehouse",
        "logistics",
        "workshop_manager",
      ].includes(user?.role || "");

      const alerts = await storage.getAlertsByUserId(userId);
      const unread = alerts.filter((alert) => !alert.isRead).length;

      const byType = {
        maintenance: 0,
        fuel: 0,
        document: 0,
        stock: 0,
        work_order: 0,
        tire: 0,
      };

      const bySeverity = {
        info: 0,
        warning: 0,
        error: 0,
        critical: 0,
      };

      let reorderCount = 0;

      for (const alert of alerts) {
        if (alert.type === "maintenance") byType.maintenance += 1;
        else if (alert.type === "fuel") byType.fuel += 1;
        else if (alert.type === "work_order") byType.work_order += 1;
        else if (alert.type === "inventory") byType.stock += 1;

        const message = alert.message.toLowerCase();
        if (message.includes("document")) byType.document += 1;
        if (message.includes("pneu")) byType.tire += 1;

        if (alert.priority === "critical") bySeverity.critical += 1;
        else if (alert.priority === "high") bySeverity.error += 1;
        else if (alert.priority === "medium") bySeverity.warning += 1;
        else bySeverity.info += 1;
      }

      // Ajouter le volume d'alertes stock calculées en temps réel (réapprovisionnement)
      if (shouldIncludeStockReorderCount) {
        try {
          const { stockAlertsService } = await import("./services/stock-alerts-service");
          const reorderAlerts = await stockAlertsService.getReorderAlerts();
          reorderCount = Number(reorderAlerts?.totalAlerts || 0);
          byType.stock += reorderCount;
          bySeverity.warning += reorderCount;
        } catch (stockError) {
          console.error("Get reorder alerts for count error:", stockError);
        }
      }

      return res.status(200).json({
        total: alerts.length + reorderCount,
        // unread must reflect only user-markable alerts from DB
        unread,
        byType,
        bySeverity,
      });
    } catch (error) {
      console.error("Get alerts count error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/alerts", isWorkshopManager, async (req, res) => {
    try {
      const parsedAlert = insertAlertSchema.parse(req.body);
      
      const alert = await storage.createAlert(parsedAlert);
      
      return res.status(201).json(alert);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Données d'alerte invalides",
          errors: error.errors 
        });
      }
      
      console.error("Create alert error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.patch("/api/alerts/:id/read", authenticate, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID d'alerte invalide" });
      }
      
      const alert = await storage.getAlert(id);
      
      if (!alert) {
        return res.status(404).json({ message: "Alerte non trouvée" });
      }
      
      const updatedAlert = await storage.markAlertAsRead(id);
      
      return res.status(200).json(updatedAlert);
    } catch (error) {
      console.error("Mark alert as read error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.delete("/api/alerts/:id", authenticate, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID d'alerte invalide" });
      }
      
      const alert = await storage.getAlert(id);
      
      if (!alert) {
        return res.status(404).json({ message: "Alerte non trouvée" });
      }
      
      await storage.deleteAlert(id);
      
      return res.status(204).send();
    } catch (error) {
      console.error("Delete alert error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Dashboard Statistics Routes
  app.get("/api/statistics/fleet", authenticate, async (req: Request, res) => {
    try {
      // Statistiques opérationnelles + KPI (cache optimisé)
      const [statistics, kpi] = await Promise.all([
        storage.getFleetStatistics(),
        vehicleStatusService.getFleetKPI(),
      ]);

      const operational = Number(statistics?.operational || 0);
      const maintenance = Number(statistics?.maintenance || 0);
      const outOfService = Number(statistics?.outOfService || 0);
      const totalVehicles = operational + maintenance + outOfService;

      // La disponibilité affichée sur les dashboards doit refléter l'état réel courant.
      const availabilityRate =
        totalVehicles > 0 ? (operational / totalVehicles) * 100 : 0;

      return res.status(200).json({
        ...statistics,
        availabilityRate,
        // Conservé pour diagnostic/analyses avancées.
        availabilityRateKpi: Number(kpi?.availabilityRate || 0),
      });
    } catch (error) {
      console.error("Get fleet statistics error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/statistics/maintenance-compliance", authenticate, async (req: Request, res) => {
    try {
      // Vérifier les permissions utilisateur
      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Non authentifié" });
      }
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(401).json({ message: "Utilisateur non trouvé" });
      }
      
      // Les clients n'ont accès qu'aux données de leurs véhicules
      if (user.role === 'client') {
        const userVehiclesData = await storage.getVehiclesByOwner(user.id);
        const userVehicles = userVehiclesData.vehicles;
        const today = new Date();
        
        const compliant = userVehicles.filter(v => 
          !v.nextMaintenanceDate || new Date(v.nextMaintenanceDate) >= today
        ).length;
        
        const overdue = userVehicles.filter(v => 
          v.nextMaintenanceDate && new Date(v.nextMaintenanceDate) < today
        ).length;
        
        const compliance = {
          compliant,
          overdue,
          total: userVehicles.length
        };
        
        return res.status(200).json(compliance);
      }
      
      // Admin, workshop_manager et technician voient toutes les données
      const compliance = await storage.getMaintenanceCompliance();
      
      return res.status(200).json(compliance);
    } catch (error) {
      console.error("Get maintenance compliance error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Fleet KPI endpoint - utilise le service de statut dédié avec cache optimisé
  app.get("/api/statistics/fleet-kpi", authenticate, async (req, res) => {
    try {
      const kpi = await vehicleStatusService.getFleetKPI();
      return res.status(200).json(kpi);
    } catch (error) {
      console.error("Get fleet KPI error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Fleet history endpoint - historique des statuts par période
  app.get("/api/statistics/fleet-history", authenticate, async (req, res) => {
    try {
      const period = req.query.period as 'week' | 'month' | 'quarter' | 'year' || 'week';
      const history = await vehicleStatusService.getFleetStatusHistory(period);
      return res.status(200).json(history);
    } catch (error) {
      console.error("Get fleet history error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Endpoint pour forcer le recalcul des KPI (admin uniquement)
  app.post("/api/statistics/fleet-kpi/refresh", isAdmin, async (req, res) => {
    try {
      await vehicleStatusService.forceRecalculateKPI();
      const kpi = await vehicleStatusService.getFleetKPI();
      return res.status(200).json({ 
        message: "KPI recalculés avec succès", 
        kpi 
      });
    } catch (error) {
      console.error("Force recalculate KPI error:", error);
      return res.status(500).json({ message: "Erreur lors du recalcul des KPI" });
    }
  });

  // Vehicle status history endpoint - utilise le service de statut dédié
  app.get("/api/vehicles/:vehicleId/status-history", authenticate, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId);
      
      if (isNaN(vehicleId)) {
        return res.status(400).json({ message: "ID de véhicule invalide" });
      }
      
      const history = await vehicleStatusService.getVehicleStatusHistory(vehicleId);
      return res.status(200).json(history);
    } catch (error) {
      console.error("Get vehicle status history error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/statistics/maintenance-cost/:period", authenticate, async (req: Request, res) => {
    try {
      // Vérifier les permissions utilisateur - DONNÉES FINANCIÈRES SENSIBLES
      const userId = req.session.userId;
      if (typeof userId !== "number") {
        return res.status(401).json({ message: "Non authentifié" });
      }
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(401).json({ message: "Utilisateur non trouvé" });
      }
      
      // RESTRICTION: Seuls admin et workshop_manager ont accès aux coûts de maintenance
      if (user.role === 'client' || user.role === 'technician') {
        return res.status(403).json({ 
          message: "Accès non autorisé - Données financières réservées à la direction" 
        });
      }
      
      const period = req.params.period as 'week' | 'month' | 'quarter' | 'year';
      
      if (!['week', 'month', 'quarter', 'year'].includes(period)) {
        return res.status(400).json({ message: "Période invalide" });
      }
      
      const cost = await storage.getMaintenanceCost(period);
      
      return res.status(200).json({ cost });
    } catch (error) {
      console.error("Get maintenance cost error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Nouveau endpoint pour les maintenances planifiées
  app.get("/api/statistics/scheduled-maintenance", authenticate, async (req, res) => {
    try {
      const period = req.query.period as 'week' | 'month' | 'quarter' | 'year' | undefined;
      
      if (period && !['week', 'month', 'quarter', 'year'].includes(period)) {
        return res.status(400).json({ message: "Période invalide" });
      }
      
      const count = await storage.getScheduledMaintenanceCount(period);
      
      return res.status(200).json({ scheduled: count });
    } catch (error) {
      console.error("Get scheduled maintenance count error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Endpoint pour les statistiques des ordres de travail
  app.get("/api/statistics/work-orders", authenticate, async (req, res) => {
    try {
      const workOrdersData = await storage.getWorkOrders();
      const workOrders = workOrdersData.workOrders;
      
      const stats = {
        pending: workOrders.filter(wo => wo.status === 'pending').length,
        inProgress: workOrders.filter(wo => wo.status === 'in_progress').length,
        completed: workOrders.filter(wo => wo.status === 'completed').length,
        total: workOrders.length
      };
      
      return res.status(200).json(stats);
    } catch (error) {
      console.error("Get work orders statistics error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
  
  // Historique du statut de la flotte basé sur les données réelles de la table status_history
  app.get("/api/statistics/fleet-history", authenticate, async (req, res) => {
    try {
      const period = req.query.period as string || 'month';
      
      // Utiliser le nouveau service de statistiques de flotte
      const { fleetStatisticsService } = await import('./services/fleet-statistics-service');
      const history = await fleetStatisticsService.getFleetStatusHistory(period as 'week' | 'month' | 'quarter' | 'year');
      
      res.json(history);
    } catch (error) {
      console.error('Error getting fleet history:', error);
      res.status(500).json({ message: 'Erreur lors de la récupération de l\'historique de la flotte' });
    }
  });


  // Statistiques spécifiques pour les techniciens
  app.get("/api/dashboard/technician-stats", authenticate, async (req, res) => {
    try {
      console.log(`📊 [STATS] Génération des statistiques pour le technicien ID: ${req.session.userId}`);
      
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ message: "Non authentifié" });
      }

      // Statistiques des véhicules - utilise les données existantes
      const vehiclesData = await storage.getVehicles();
      const vehicles = vehiclesData.vehicles || [];
      const vehicleStats = {
        total: vehicles.length,
        operational: vehicles.filter((v) => v.status === 'operational').length,
        maintenance: vehicles.filter((v) => v.status === 'maintenance').length,
        inactive: vehicles.filter((v) => v.status === 'out_of_service').length
      };

      // Ordres de travail du technicien (requête directe filtrée).
      const technicianWorkOrders = await db
        .select({
          id: workOrders.id,
          status: workOrders.status,
          endDate: workOrders.endDate,
          createdAt: workOrders.createdAt,
          technicianId: workOrders.technicianId,
        })
        .from(workOrders)
        .where(eq(workOrders.technicianId, userId));
      
      const workOrderStats = {
        total: technicianWorkOrders.length,
        pending: technicianWorkOrders.filter((wo) => wo.status === 'pending').length,
        in_progress: technicianWorkOrders.filter((wo) => wo.status === 'in_progress').length,
        completed: technicianWorkOrders.filter((wo) => wo.status === 'completed').length,
        overdue: technicianWorkOrders.filter((wo) => {
          if (!wo.endDate) return false;
          return new Date(wo.endDate) < new Date() && wo.status !== 'completed';
        }).length
      };

      // Maintenance à venir - données factices temporaires
      const now = new Date();
      const upcomingMaintenance = vehicles.filter((v) => {
        if (!v.nextMaintenanceDate) return false;
        const maintenanceDate = new Date(v.nextMaintenanceDate);
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        return maintenanceDate >= now && maintenanceDate <= sevenDaysFromNow;
      });

      // Performance du technicien basée sur les ordres complétés
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const recentCompletedOrders = technicianWorkOrders.filter((wo) => 
        wo.status === 'completed' && 
        wo.endDate && 
        new Date(wo.endDate) >= thirtyDaysAgo
      );

      const technicianPerformance = {
        ordersCompletedLast30Days: recentCompletedOrders.length,
        averageCompletionTime: recentCompletedOrders.length > 0 
          ? recentCompletedOrders.reduce((sum: number, wo) => {
              if (wo.createdAt && wo.endDate) {
                return sum + (new Date(wo.endDate).getTime() - new Date(wo.createdAt).getTime());
              }
              return sum;
            }, 0) / recentCompletedOrders.length / (1000 * 60 * 60 * 24) // en jours
          : 0
      };

      const stats = {
        vehicles: vehicleStats,
        workOrders: workOrderStats,
        upcomingMaintenance: upcomingMaintenance.length,
        upcomingMaintenanceList: upcomingMaintenance.map((v) => ({
          id: v.id,
          vehicleRegistration: v.registrationNumber,
          maintenanceType: 'Maintenance préventive',
          dueDate: v.nextMaintenanceDate,
          priority: 'normale'
        })),
        performance: technicianPerformance,
        lastUpdated: new Date().toISOString()
      };

      console.log(`📈 [STATS] Statistiques générées pour technicien ID ${userId}:`, {
        vehiclesTotal: vehicleStats.total,
        workOrdersAssigned: workOrderStats.total,
        upcomingMaintenance: upcomingMaintenance.length
      });

      res.json(stats);
    } catch (error) {
      console.error(`❌ [STATS] Erreur lors de la génération des statistiques:`, error);
      res.status(500).json({ message: "Erreur lors de la récupération des statistiques" });
    }
  });

  // Routes pour le catalogue d'interventions
  app.get("/api/fault-catalog", authenticate, async (req, res) => {
    try {
      const catalogs = await storage.getFaultCatalogs();
      res.json(catalogs);
    } catch (error) {
      console.error("Get fault catalogs error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/fault-catalog", isWorkshopManager, async (req, res, next) => {
    try {
      // createdBy vient de la session, validatedBy d'une validation : jamais du corps.
      const { createdBy: _createdBy, validatedBy: _validatedBy, ...catalogPayload } = req.body ?? {};
      const catalogData = insertFaultCatalogSchema.parse({ ...catalogPayload, createdBy: req.user?.id });

      const catalog = await storage.createFaultCatalog(catalogData);
      res.status(201).json(catalog);
    } catch (error) {
      if (error instanceof z.ZodError) return next(error);
      log.error({ err: error, requestId: req.requestId }, "Create fault catalog error");
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.patch("/api/fault-catalog/:id", isWorkshopManager, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID invalide" });
      }

      const { id: _id, createdBy: _createdBy, createdAt: _createdAt, updatedAt: _updatedAt, ...catalogPayload } = req.body ?? {};
      const { data, errors } = prepareColumnUpdate(faultCatalog, catalogPayload);
      if (errors.length > 0) {
        return next(new AppError(400, "Certaines informations de la panne sont invalides.", { fieldErrors: errors }));
      }

      const catalog = await storage.updateFaultCatalog(id, data);
      res.json(catalog);
    } catch (error) {
      log.error({ err: error, requestId: req.requestId }, "Update fault catalog error");
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.delete("/api/fault-catalog/:id", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID invalide" });
      }

      await storage.deleteFaultCatalog(id);
      res.status(204).send();
    } catch (error) {
      console.error("Delete fault catalog error:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Route spéciale pour importer les données après déploiement
  app.post("/api/admin/import-backup", authenticate, isAdmin, async (req: Request, res: Response) => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      
      // Chercher le fichier de backup
      const backupDir = path.join(process.cwd(), 'backup');
      if (!fs.existsSync(backupDir)) {
        return res.status(404).json({ message: "Dossier de backup non trouvé" });
      }

      const files = fs.readdirSync(backupDir);
      const backupFile = files.find(f => f.startsWith('fleet-backup-') && f.endsWith('.json'));
      
      if (!backupFile) {
        return res.status(404).json({ 
          message: "Fichier de backup non trouvé",
          availableFiles: files
        });
      }

      const backupFilePath = path.join(backupDir, backupFile);
      const backupData = JSON.parse(fs.readFileSync(backupFilePath, 'utf8'));

      console.log('📥 Import des données de backup en cours...');

      // Nettoyer les tables (sauf utilisateurs pour garder l'admin)
      const { db } = await import("../server/db");
      const { alerts, fuelRecords, maintenanceSchedules, workOrders, parts, vehicles, users } = await import("../shared/schema");
      
      await db.delete(alerts);
      await db.delete(fuelRecords);
      await db.delete(maintenanceSchedules);
      await db.delete(workOrders);
      await db.delete(parts);
      await db.delete(vehicles);

      let importStats = {
        users: 0,
        vehicles: 0,
        parts: 0,
        workOrders: 0,
        maintenanceSchedules: 0,
        fuelRecords: 0,
        alerts: 0
      };

      // Importer les utilisateurs (éviter les doublons)
      if (backupData.users && backupData.users.length > 0) {
        const existingUsers = await db.select().from(users);
        const existingUsernames = existingUsers.map((u: any) => u.username);
        const usersToImport = backupData.users.filter((u: any) => !existingUsernames.includes(u.username));
        
        if (usersToImport.length > 0) {
          await db.insert(users).values(usersToImport);
          importStats.users = usersToImport.length;
        }
      }

      // Importer les véhicules
      if (backupData.vehicles && backupData.vehicles.length > 0) {
        await db.insert(vehicles).values(backupData.vehicles);
        importStats.vehicles = backupData.vehicles.length;
      }

      // Importer les pièces
      if (backupData.parts && backupData.parts.length > 0) {
        await db.insert(parts).values(backupData.parts);
        importStats.parts = backupData.parts.length;
      }

      // Importer les ordres de travail
      if (backupData.workOrders && backupData.workOrders.length > 0) {
        await db.insert(workOrders).values(backupData.workOrders);
        importStats.workOrders = backupData.workOrders.length;
      }

      // Importer les plannings
      if (backupData.maintenanceSchedules && backupData.maintenanceSchedules.length > 0) {
        await db.insert(maintenanceSchedules).values(backupData.maintenanceSchedules);
        importStats.maintenanceSchedules = backupData.maintenanceSchedules.length;
      }

      // Importer les carburants
      if (backupData.fuelRecords && backupData.fuelRecords.length > 0) {
        await db.insert(fuelRecords).values(backupData.fuelRecords);
        importStats.fuelRecords = backupData.fuelRecords.length;
      }

      // Importer les alertes
      if (backupData.alerts && backupData.alerts.length > 0) {
        await db.insert(alerts).values(backupData.alerts);
        importStats.alerts = backupData.alerts.length;
      }

      console.log('✅ Import terminé!', importStats);

      res.json({
        success: true,
        message: "Données importées avec succès",
        stats: importStats,
        backupFile: backupFile,
        exportDate: backupData.exportDate
      });

    } catch (error) {
      console.error('❌ Erreur lors de l\'import:', error);
      const errorMessage = error instanceof Error ? error.message : "Erreur inconnue";
      res.status(500).json({ 
        success: false,
        message: "Erreur lors de l'import des données",
        error: errorMessage
      });
    }
  });

  // ===== TIRE MANAGEMENT ROUTES =====

  // Tire inventory routes
  app.get("/api/tires", authenticate, async (req, res) => {
    try {
      const search = req.query.search as string;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;
      
      const result = await tiresService.getTires({ 
        brand: search, 
        model: search, 
        size: search, 
        limit, 
        offset 
      });
      
      return res.status(200).json(result);
    } catch (error) {
      console.error("Get tires error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/tires/statistics", authenticate, async (req, res) => {
    try {
      const stats = await tiresService.getTireStatistics();
      return res.status(200).json(stats);
    } catch (error) {
      console.error("Get tire statistics error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/tires/statistics-advanced", authenticate, async (req, res) => {
    try {
      const stats = await tiresService.getTireStatisticsAdvanced();
      return res.status(200).json(stats);
    } catch (error) {
      console.error("Get advanced tire statistics error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/tires/low-stock", authenticate, async (req, res) => {
    try {
      const lowStockTires = await tiresService.getLowStockTires();
      return res.status(200).json(lowStockTires);
    } catch (error) {
      console.error("Get low stock tires error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/tires/:id", authenticate, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de pneu invalide" });
      }
      
      const tire = await tiresService.getTire(id);
      
      if (!tire) {
        return res.status(404).json({ message: "Pneu non trouvé" });
      }
      
      return res.status(200).json(tire);
    } catch (error) {
      console.error("Get tire error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/tires", isTireCatalogManager, async (req, res) => {
    try {
      const { normalizeTireCreatePayload } = await import("@shared/tire-form");
      const { insertTireSchema } = await import("@shared/schema");
      const { ZodError } = await import("zod");
      const dbPayload = normalizeTireCreatePayload(req.body);
      const tire = await tiresService.createTire(insertTireSchema.parse(dbPayload), req.user?.id);
      return res.status(201).json(tire);
    } catch (error) {
      console.error("Create tire error:", error);
      const { ZodError } = await import("zod");
      if (error instanceof ZodError) {
        return res.status(400).json({ message: "Données pneu invalides", details: error.errors });
      }
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.patch("/api/tires/:id", isTireCatalogManager, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de pneu invalide" });
      }

      const { insertTireSchema } = await import("@shared/schema");
      const tire = await tiresService.updateTire(
        id,
        insertTireSchema.partial().parse(req.body),
        req.user?.id,
      );
      if (!tire) return next(new AppError(404, "Ce pneu n'existe pas ou a été supprimé."));
      return res.status(200).json(tire);
    } catch (error) {
      if (error instanceof z.ZodError) return next(error);
      log.error({ err: error, requestId: req.requestId }, "Update tire error");
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.delete("/api/tires/:id", isAdmin, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.id;
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de pneu invalide" });
      }
      
      const success = await tiresService.deleteTire(id, userId);
      
      if (!success) {
        return res.status(404).json({ message: "Pneu non trouvé" });
      }
      
      return res.status(204).send();
    } catch (error) {
      if (error instanceof AppError) return next(error);
      log.error({ err: error, requestId: req.requestId }, "Delete tire error");
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Vehicle tire tracking routes
  app.get("/api/vehicles/:vehicleId/tires", authenticate, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId);
      
      if (isNaN(vehicleId)) {
        return res.status(400).json({ message: "ID de véhicule invalide" });
      }
      
      const vehicleTires = await tiresService.getVehicleTires(vehicleId);
      return res.status(200).json(vehicleTires);
    } catch (error) {
      console.error("Get vehicle tires error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Route pour vérifier toutes les maintenances (kilométrage + dates)
  app.post("/api/check-all-maintenance", isWorkshopManager, async (req, res) => {
    try {
      const { preventiveMaintenanceService } = await import('./services/preventive-maintenance-service');
      
      console.log('🔍 Vérification globale des maintenances démarrée...');
      
      // Vérifier les maintenances kilométriques
      const kmResults = await preventiveMaintenanceService.checkMileageBasedMaintenance(5000, 10000);
      console.log(`✅ Maintenances kilométriques: ${kmResults.length} ordres créés`);
      
      // Vérifier les maintenances basées sur les dates
      const dateResults = await preventiveMaintenanceService.checkDateBasedMaintenance();
      console.log(`✅ Maintenances basées sur les dates: ${dateResults.length} ordres créés`);
      
      const totalWorkOrders = kmResults.length + dateResults.length;
      const actorUserId = typeof req.session?.userId === "number" ? req.session.userId : undefined;
      const statusReconciliation = await reconcileVehicleStatusesFromWorkOrders(actorUserId);
      
      return res.status(200).json({
        success: true,
        message: `Vérification terminée. ${totalWorkOrders} nouveaux ordres de travail créés.`,
        details: {
          kilometerBased: { workOrdersCreated: kmResults.length },
          dateBased: { workOrdersCreated: dateResults.length },
          total: totalWorkOrders,
          statusReconciliation,
        }
      });
    } catch (error) {
      console.error("Erreur lors de la vérification des maintenances:", error);
      return res.status(500).json({ 
        success: false,
        message: "Erreur lors de la vérification des maintenances" 
      });
    }
  });

  // Routes pour les rappels de workflows
  app.get("/api/workflows/active", authenticate, async (req, res) => {
    try {
      const { workflowReminderService } = await import('./services/workflow-reminder-service');
      const userId = req.session.userId;
      
      if (!userId) {
        return res.status(401).json({ message: "Non authentifié" });
      }

      const activeWorkflows = await workflowReminderService.getActiveWorkflowsForUser(userId);
      return res.status(200).json(activeWorkflows);
    } catch (error) {
      console.error("Get active workflows error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/workflows/stats", authenticate, async (req, res) => {
    try {
      const { workflowReminderService } = await import('./services/workflow-reminder-service');
      const userId = req.session.userId;
      
      if (!userId) {
        return res.status(401).json({ message: "Non authentifié" });
      }

      const stats = await workflowReminderService.getWorkflowStatsForUser(userId);
      return res.status(200).json(stats);
    } catch (error) {
      console.error("Get workflow stats error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.patch("/api/workflows/active/:sessionId/abandon", authenticate, async (req, res) => {
    try {
      const { workflowReminderService } = await import('./services/workflow-reminder-service');
      const userId = req.session.userId;
      const sessionId = req.params.sessionId;
      
      if (!userId) {
        return res.status(401).json({ message: "Non authentifié" });
      }

      const success = await workflowReminderService.abandonWorkflow(userId, sessionId);
      if (success) {
        return res.status(200).json({ message: "Workflow abandonné avec succès" });
      } else {
        return res.status(404).json({ message: "Workflow non trouvé" });
      }
    } catch (error) {
      console.error("Abandon workflow error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Global vehicle tires endpoint for the interface
  app.get("/api/vehicle-tires", authenticate, async (req, res) => {
    try {
      const allVehicleTires = await tiresService.getAllVehicleTires();
      return res.status(200).json(allVehicleTires);
    } catch (error) {
      console.error("Get all vehicle tires error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Routes pour les documents de workflow d'acquisition
  app.post("/api/workflows/:sessionId/documents", authenticate, upload.single('document'), async (req, res, next) => {
    try {
      const { WorkflowDocumentService, isWorkflowDocumentType } = await import('./services/workflow-document-service');
      const sessionId = req.params.sessionId;
      const userId = req.session.userId;

      if (!userId) {
        return res.status(401).json({ message: "Non authentifié" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "Aucun fichier fourni" });
      }

      const { documentType, workflowId } = req.body;

      if (!documentType || !workflowId) {
        return res.status(400).json({ message: "Type de document et ID workflow requis" });
      }

      // sessionId et documentType servent à construire le chemin disque.
      if (!isSafePathSegment(sessionId)) {
        return next(new AppError(400, "Session de workflow invalide."));
      }
      if (!isWorkflowDocumentType(documentType)) {
        return next(new AppError(400, "Type de document inconnu."));
      }

      const documentData = {
        workflowId: parseInt(workflowId),
        sessionId: sessionId,
        documentType: documentType,
        originalName: req.file.originalname,
        fileBuffer: req.file.buffer,
        mimeType: req.file.mimetype,
        uploadedBy: userId
      };

      const document = await WorkflowDocumentService.saveWorkflowDocument(documentData);
      return res.status(201).json(document);
      
    } catch (error) {
      if (error instanceof AppError) return next(error);
      log.error({ err: error, requestId: req.requestId }, "upload du document workflow en échec");
      return res.status(500).json({ message: "Erreur lors de l'upload du document" });
    }
  });

  app.get("/api/workflows/:sessionId/documents", isAnyUser, async (req, res, next) => {
    try {
      const { WorkflowDocumentService } = await import('./services/workflow-document-service');
      const sessionId = req.params.sessionId;
      
      const documents = await WorkflowDocumentService.getWorkflowDocuments(sessionId, ownerScopeOf(req.user));
      return res.status(200).json(documents);
      
    } catch (error) {
      if (error instanceof AppError) return next(error);
      log.error({ err: error, requestId: req.requestId }, "lecture des documents workflow en échec");
      return res.status(500).json({ message: "Erreur lors de la récupération des documents" });
    }
  });

  app.get("/api/workflows/documents/:documentId", isAnyUser, async (req, res) => {
    try {
      const { WorkflowDocumentService } = await import('./services/workflow-document-service');
      const documentId = parseInt(req.params.documentId);
      
      if (isNaN(documentId)) {
        return res.status(400).json({ message: "ID de document invalide" });
      }

      const document = await WorkflowDocumentService.getWorkflowDocument(documentId);
      
      if (!document) {
        return res.status(404).json({ message: "Document non trouvé" });
      }

      if (!(await canAccessOwned(req.user, () => WorkflowDocumentService.getWorkflowOwnerId(document.workflowId)))) {
        return res.status(403).json({ message: OUT_OF_SCOPE_MESSAGE });
      }

      const fs = await import('fs');
      
      // Chemin stocké en base : on ne sert qu'un fichier situé sous uploads/.
      const filePath = uploadedFileCandidates(document.filePath).find((candidate) => fs.existsSync(candidate));

      if (!filePath) {
        return res.status(404).json({ message: "Fichier non trouvé" });
      }

      res.setHeader('Content-Type', document.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${document.originalName}"`);
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
      
    } catch (error) {
      log.error({ err: error, requestId: req.requestId }, "téléchargement du document workflow en échec");
      return res.status(500).json({ message: "Erreur lors du téléchargement du document" });
    }
  });

  // Endpoint pour déclencher une action depuis les alertes de maintenance
  app.post("/api/test-date-maintenance", authenticate, async (req, res) => {
    try {
      const payloadSchema = z.object({
        vehicleId: z.number().int().positive(),
        alertType: z.enum(['maintenance', 'insurance', 'inspection', 'license'])
      });
      const parsedPayload = payloadSchema.safeParse(req.body);

      if (!parsedPayload.success) {
        return res.status(400).json({
          message: "Payload invalide: vehicleId et alertType sont requis",
          errors: parsedPayload.error.errors
        });
      }

      const { vehicleId, alertType } = parsedPayload.data;
      const createdBy: number | undefined = req.session?.userId ?? undefined;

      if (alertType === 'maintenance') {
        // Créer un OT relève de l'atelier, comme POST /api/work-orders; les
        // demandes documentaires (branche suivante) restent ouvertes au secrétariat.
        const actor = createdBy ? await storage.getUser(createdBy) : undefined;
        if (!actor || !['admin', 'workshop_manager'].includes(normalizeRole(actor.role))) {
          return res.status(403).json({ message: "Accès non autorisé" });
        }
        const generatedWorkOrders = await preventiveMaintenanceService.checkDateBasedMaintenance(vehicleId, alertType, createdBy);
        
        // Sécurité: un clic par alerte ne doit jamais créer plusieurs OT
        if (generatedWorkOrders.length > 1) {
          return res.status(409).json({
            message: "Plusieurs OT générés pour une seule alerte - comportement bloqué",
            workOrdersGenerated: generatedWorkOrders.length,
            workOrders: generatedWorkOrders
          });
        }
        
        return res.json({
          actionType: "work_order",
          message: `OT traité`,
          workOrdersGenerated: generatedWorkOrders.length,
          workOrders: generatedWorkOrders
        });
      }

      // Pour les alertes documentaires, on crée une demande administrative (et non un OT atelier)
      const vehicle = await storage.getVehicle(vehicleId);
      if (!vehicle) {
        return res.status(404).json({ message: "Véhicule non trouvé" });
      }

      const requestByType: Record<'insurance' | 'inspection' | 'license', { title: string; documentLabel: string }> = {
        insurance: {
          title: "Demande renouvellement assurance",
          documentLabel: "Assurance"
        },
        inspection: {
          title: "Demande contrôle technique",
          documentLabel: "Contrôle technique"
        },
        license: {
          title: "Demande renouvellement plaque",
          documentLabel: "Plaque d'immatriculation"
        }
      };

      const requestConfig = requestByType[alertType as 'insurance' | 'inspection' | 'license'];
      const recipients = [
        ...(await storage.getUsersByRole("admin")),
        ...(await storage.getUsersByRole("workshop_manager")),
      ];

      const recipientIds = Array.from(new Set(recipients.map((user) => user.id)));
      const requestMessage = `${requestConfig.documentLabel} à renouveler pour le véhicule ${vehicle.registrationNumber}. Demande créée depuis les alertes de maintenance.`;
      const requestLink = `/vehicles/${vehicle.id}`;
      let requestsCreated = 0;

      for (const recipientId of recipientIds) {
        const unreadAlerts = await storage.getUnreadAlertsByUserId(recipientId);
        const exists = unreadAlerts.some((alert) =>
          alert.title === requestConfig.title &&
          alert.link === requestLink
        );

        if (exists) {
          continue;
        }

        await storage.createAlert({
          userId: recipientId,
          title: requestConfig.title,
          message: requestMessage,
          type: "maintenance",
          priority: "high",
          link: requestLink,
        });
        requestsCreated += 1;
      }

      return res.json({
        actionType: "request",
        message: "Demande administrative traitée",
        requestsCreated,
        workOrdersGenerated: 0,
        workOrders: []
      });
    } catch (error) {
      console.error('Test date maintenance error:', error);
      return res.status(500).json({ message: "Erreur lors du test de maintenance basée sur la date" });
    }
  });

  // Vérification globale de toutes les maintenances (tâche cron)
  app.post("/api/check-all-maintenance", isWorkshopManager, async (req, res) => {
    try {
      const dateWorkOrders = await preventiveMaintenanceService.checkDateBasedMaintenance();
      
      return res.json({
        message: `Vérification globale terminée`,
        totalWorkOrdersGenerated: dateWorkOrders.length,
        dateBasedWorkOrders: dateWorkOrders.length,
        workOrders: dateWorkOrders
      });
    } catch (error) {
      console.error('Test global maintenance error:', error);
      return res.status(500).json({ message: "Erreur lors de la vérification globale de maintenance" });
    }
  });

  app.delete("/api/workflows/documents/:documentId", isAnyUser, async (req, res, next) => {
    try {
      const { WorkflowDocumentService } = await import('./services/workflow-document-service');
      const documentId = parseInt(req.params.documentId);
      
      if (isNaN(documentId)) {
        return res.status(400).json({ message: "ID de document invalide" });
      }

      const document = await WorkflowDocumentService.getWorkflowDocument(documentId);
      if (!document) {
        return res.status(404).json({ message: "Document non trouvé" });
      }

      // Même cloison qu'en lecture : l'auteur de la session et le personnel.
      if (!(await canAccessOwned(req.user, () => WorkflowDocumentService.getWorkflowOwnerId(document.workflowId)))) {
        return res.status(403).json({ message: OUT_OF_SCOPE_MESSAGE });
      }

      await WorkflowDocumentService.deleteWorkflowDocument(documentId);
      return res.status(204).send();
      
    } catch (error) {
      if (error instanceof AppError) return next(error);
      log.error({ err: error, requestId: req.requestId }, "suppression du document de workflow en échec");
      return res.status(500).json({ message: "Erreur lors de la suppression du document" });
    }
  });

  app.post("/api/vehicles/:vehicleId/tires", isWorkshopManager, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId);
      
      if (isNaN(vehicleId)) {
        return res.status(400).json({ message: "ID de véhicule invalide" });
      }
      
      // Valider avant insertion: sans ça, un champ obligatoire manquant
      // (`installationDate`, `installationMileage`...) remontait en 500 alors
      // que c'est une erreur client. Même traitement que POST /api/tires.
      const { insertVehicleTireSchema } = await import("@shared/schema");
      const vehicleTireData = insertVehicleTireSchema.parse({
        ...req.body,
        vehicleId,
      });

      const vehicleTire = await tiresService.installTireOnVehicle(vehicleTireData);
      return res.status(201).json(vehicleTire);
    } catch (error) {
      const { ZodError } = await import("zod");
      if (error instanceof ZodError) {
        return res.status(400).json({
          message: "Données de montage invalides",
          details: error.errors,
        });
      }
      if (error instanceof Error) {
        if (error.message === "POSITION_OCCUPIED") {
          return res.status(409).json({ message: "Cette position est déjà occupée sur le véhicule" });
        }
        if (error.message === "INSUFFICIENT_STOCK") {
          return res.status(409).json({ message: "Stock insuffisant pour cette référence pneu" });
        }
      }
      console.error("Install tire on vehicle error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.patch("/api/vehicle-tires/:id", isWorkshopManager, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de pneu véhicule invalide" });
      }

      // Le cycle de vie (montage, démontage, destination) déplace du stock : routes dédiées seulement.
      const { VEHICLE_TIRE_LIFECYCLE_FIELDS } = await import("@shared/constants/tire-removal");
      const lifecycleFields = VEHICLE_TIRE_LIFECYCLE_FIELDS.filter((field) => field in (req.body ?? {}));
      if (lifecycleFields.length > 0) {
        return next(new AppError(400, "Le montage et le démontage d'un pneu passent par leurs actions dédiées.", {
          fieldErrors: lifecycleFields.map((field) => ({ field, message: "Non modifiable ici." })),
        }));
      }

      const { data, errors } = prepareColumnUpdate(vehicleTires, req.body ?? {});
      if (errors.length > 0) {
        return next(new AppError(400, "Certaines informations du pneu monté sont invalides.", { fieldErrors: errors }));
      }

      const vehicleTire = await tiresService.updateVehicleTire(id, data);
      return res.status(200).json(vehicleTire);
    } catch (error) {
      log.error({ err: error, requestId: req.requestId }, "Update vehicle tire error");
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.patch("/api/vehicle-tires/:id/remove", isWorkshopManager, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);

      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de pneu véhicule invalide" });
      }

      const { tireRemovalSchema } = await import("@shared/constants/tire-removal");
      const removal = tireRemovalSchema.parse(req.body);

      const success = await tiresService.removeTireFromVehicle(id, removal, req.user?.id);
      if (success) {
        return res.status(200).json({ message: "Pneu retiré avec succès" });
      } else {
        return res.status(404).json({ message: "Pneu de véhicule non trouvé" });
      }
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof AppError) return next(error);
      log.error({ err: error, requestId: req.requestId }, "Remove tire from vehicle error");
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Tire inspection routes
  app.get("/api/tire-inspections", authenticate, async (req, res) => {
    try {
      const vehicleTireId = req.query.vehicleTireId ? parseInt(req.query.vehicleTireId as string) : undefined;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;
      
      const inspections = await tiresService.getTireInspections();
      return res.status(200).json(inspections);
    } catch (error) {
      console.error("Get tire inspections error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/tire-inspections/recent", authenticate, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const inspections = await tiresService.getTireInspections();
      
      // Retourner les inspections simplifiées (limite appliquée)
      return res.status(200).json(inspections.slice(0, limit));
    } catch (error) {
      console.error("Get recent tire inspections error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/tire-inspections", isTechnician, async (req, res, next) => {
    try {
      const { insertTireInspectionSchema } = await import("@shared/schema");
      // L'inspecteur est toujours l'auteur de la requête, jamais une valeur du corps.
      const inspectionData = insertTireInspectionSchema.parse({ ...req.body, inspectedBy: req.user?.id });

      const inspection = await tiresService.createTireInspection(inspectionData);
      return res.status(201).json(inspection);
    } catch (error) {
      if (error instanceof z.ZodError) return next(error);
      log.error({ err: error, requestId: req.requestId }, "Create tire inspection error");
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Détail d'une inspection par ID
  app.get("/api/tire-inspections/:id", authenticate, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID d'inspection invalide" });
      }
      
      const inspection = await tiresService.getInspectionById(id);
      
      if (!inspection) {
        return res.status(404).json({ message: "Inspection non trouvée" });
      }
      
      return res.status(200).json(inspection);
    } catch (error) {
      console.error("Get tire inspection by ID error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/vehicle-tires/:vehicleTireId/last-inspection", authenticate, async (req, res) => {
    try {
      const vehicleTireId = parseInt(req.params.vehicleTireId);
      
      if (isNaN(vehicleTireId)) {
        return res.status(400).json({ message: "ID de pneu véhicule invalide" });
      }
      
      const lastInspection = await tiresService.getLastInspection();
      return res.status(200).json(lastInspection);
    } catch (error) {
      console.error("Get last inspection error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Tire rotation routes
  app.get("/api/tire-rotations", authenticate, async (req, res) => {
    try {
      const vehicleId = req.query.vehicleId ? parseInt(req.query.vehicleId as string) : undefined;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;
      
      const rotations = await tiresService.getTireRotations();
      return res.status(200).json(rotations);
    } catch (error) {
      console.error("Get tire rotations error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/tire-rotations", isWorkshopManager, async (req, res, next) => {
    try {
      const { insertTireRotationSchema } = await import("@shared/schema");
      // OT et auteur sont posés par le serveur ; le formulaire envoie le coût en nombre.
      const rotationInput = insertTireRotationSchema
        .omit({ workOrderId: true, performedBy: true, createdBy: true })
        .extend({
          cost: z.coerce.number().nonnegative().nullish(),
          technicianId: z.number().int().positive().nullish(),
        });

      const rotationData = {
        ...rotationInput.parse(req.body?.rotation ?? {}),
        performedBy: req.user?.id,
      };

      const result = await tiresService.createTireRotation(rotationData);
      return res.status(201).json(result);
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof AppError) return next(error);
      log.error({ err: error, requestId: req.requestId }, "Create tire rotation error");
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/tire-rotations/:id/details", authenticate, async (req, res) => {
    try {
      const rotationId = parseInt(req.params.id);
      
      if (isNaN(rotationId)) {
        return res.status(400).json({ message: "ID de rotation invalide" });
      }
      
      const details = await tiresService.getTireRotationDetails();
      return res.status(200).json(details);
    } catch (error) {
      console.error("Get tire rotation details error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Routes pour les alertes
  app.get("/api/alerts/unread", authenticate, async (req, res) => {
    try {
      const userId = 1; // TODO: récupérer depuis la session utilisateur
      const alerts = await storage.getUnreadAlertsByUserId(userId);
      return res.status(200).json(alerts);
    } catch (error) {
      console.error("Get unread alerts error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/alerts", authenticate, async (req, res) => {
    try {
      const userId = 1; // TODO: récupérer depuis la session utilisateur
      const alerts = await storage.getAlertsByUserId(userId);
      return res.status(200).json(alerts);
    } catch (error) {
      console.error("Get alerts error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.patch("/api/alerts/:id/read", authenticate, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID d'alerte invalide" });
      }
      
      const alert = await storage.markAlertAsRead(id);
      
      if (!alert) {
        return res.status(404).json({ message: "Alerte non trouvée" });
      }
      
      return res.status(200).json(alert);
    } catch (error) {
      console.error("Mark alert as read error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.delete("/api/alerts/:id", authenticate, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID d'alerte invalide" });
      }
      
      const deleted = await storage.deleteAlert(id);
      
      if (!deleted) {
        return res.status(404).json({ message: "Alerte non trouvée" });
      }
      
      return res.status(204).send();
    } catch (error) {
      console.error("Delete alert error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Routes pour la persistance des workflows d'acquisition de véhicules
  app.post("/api/workflows/vehicle-acquisition", authenticate, async (req, res) => {
    try {
      const { workflowService } = await import('./services/workflow-service');
      const { VehicleAutoCreation } = await import('./services/vehicle-auto-creation');
      const userId = req.session.userId;
      
      if (!userId) {
        return res.status(401).json({ message: "Non authentifié" });
      }

      const workflow = await workflowService.saveWorkflowState({
        ...req.body,
        userId
      });

      // Si le workflow est terminé (étape 5), activer automatiquement le véhicule
      if (workflow.currentStep === 5 && workflow.status === 'completed') {
        try {
          console.log('🚛 Activation automatique du véhicule depuis le workflow terminé');
          const vehicleId = await VehicleAutoCreation.createVehicleFromWorkflow(
            workflow.workflowData as any
          );
          
          console.log('✅ Véhicule activé automatiquement:', vehicleId);
        } catch (activationError) {
          console.error('❌ Erreur lors de l\'activation automatique:', activationError);
          // Ne pas faire échouer la sauvegarde du workflow pour autant
        }
      }

      return res.status(200).json(workflow);
    } catch (error) {
      console.error("Save workflow error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.get("/api/workflows/vehicle-acquisition/:sessionId", authenticate, async (req, res) => {
    try {
      const { workflowService } = await import('./services/workflow-service');
      const userId = req.session.userId;
      const sessionId = req.params.sessionId;
      
      if (!userId) {
        return res.status(401).json({ message: "Non authentifié" });
      }

      const workflow = await workflowService.getWorkflowState(userId, sessionId);
      return res.status(200).json(workflow);
    } catch (error) {
      console.error("Get workflow error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Route PATCH pour la sauvegarde progressive des workflows
  app.patch("/api/workflows/vehicle-acquisition/:sessionId", authenticate, async (req, res) => {
    try {
      const { workflowService } = await import('./services/workflow-service');
      const userId = req.session.userId;
      const sessionId = req.params.sessionId;
      
      if (!userId) {
        return res.status(401).json({ message: "Non authentifié" });
      }

      const workflow = await workflowService.updateWorkflowState(userId, sessionId, req.body);
      return res.status(200).json(workflow);
    } catch (error) {
      console.error("Update workflow error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.patch("/api/workflows/vehicle-acquisition/:sessionId/complete", authenticate, async (req, res) => {
    try {
      const { workflowService } = await import('./services/workflow-service');
      const userId = req.session.userId;
      const sessionId = req.params.sessionId;
      
      if (!userId) {
        return res.status(401).json({ message: "Non authentifié" });
      }

      await workflowService.completeWorkflow(userId, sessionId);
      return res.status(200).json({ message: "Workflow terminé avec succès" });
    } catch (error) {
      console.error("Complete workflow error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.patch("/api/workflows/vehicle-acquisition/:sessionId/abandon", authenticate, async (req, res) => {
    try {
      const { workflowService } = await import('./services/workflow-service');
      const userId = req.session.userId;
      const sessionId = req.params.sessionId;
      
      if (!userId) {
        return res.status(401).json({ message: "Non authentifié" });
      }

      await workflowService.abandonWorkflow(userId, sessionId);
      return res.status(200).json({ message: "Workflow abandonné" });
    } catch (error) {
      console.error("Abandon workflow error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // User onboarding routes
  app.get("/api/onboarding/status", authenticate, async (req, res) => {
    try {
      const userId = req.session.userId;
      
      if (!userId) {
        return res.status(401).json({ message: "Non authentifié" });
      }

      const [existingOnboarding] = await db
        .select()
        .from(userOnboarding)
        .where(eq(userOnboarding.userId, userId));

      if (!existingOnboarding) {
        // Create initial onboarding record
        const [newOnboarding] = await db
          .insert(userOnboarding)
          .values({ userId })
          .returning();
        return res.status(200).json(newOnboarding);
      }

      return res.status(200).json(existingOnboarding);
    } catch (error) {
      console.error("Get onboarding status error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.patch("/api/onboarding/step", authenticate, async (req, res) => {
    try {
      const userId = req.session.userId;
      const { currentStep, stepsCompleted } = req.body;
      
      if (!userId) {
        return res.status(401).json({ message: "Non authentifié" });
      }

      const [updatedOnboarding] = await db
        .update(userOnboarding)
        .set({ 
          currentStep,
          stepsCompleted,
          updatedAt: new Date()
        })
        .where(eq(userOnboarding.userId, userId))
        .returning();

      return res.status(200).json(updatedOnboarding);
    } catch (error) {
      console.error("Update onboarding step error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.patch("/api/onboarding/complete", authenticate, async (req, res) => {
    try {
      const userId = req.session.userId;
      
      if (!userId) {
        return res.status(401).json({ message: "Non authentifié" });
      }

      const [completedOnboarding] = await db
        .update(userOnboarding)
        .set({ 
          onboardingCompleted: true,
          completedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(userOnboarding.userId, userId))
        .returning();

      return res.status(200).json(completedOnboarding);
    } catch (error) {
      console.error("Complete onboarding error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.patch("/api/onboarding/mascot", authenticate, async (req, res) => {
    try {
      const userId = req.session.userId;
      const { mascotHidden } = req.body;
      
      if (!userId) {
        return res.status(401).json({ message: "Non authentifié" });
      }

      const [updatedOnboarding] = await db
        .update(userOnboarding)
        .set({ 
          mascotHidden,
          updatedAt: new Date()
        })
        .where(eq(userOnboarding.userId, userId))
        .returning();

      return res.status(200).json(updatedOnboarding);
    } catch (error) {
      console.error("Update mascot visibility error:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Documentation routes
  app.get("/api/documentation/:filename", authenticate, isAdmin, async (req, res) => {
    try {
      const { filename } = req.params;
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // Sécurité: vérifier que le fichier est bien dans la liste autorisée
      const allowedFiles = ['GUIDE_UTILISATEUR.md', 'CAHIER_TESTS_UTILISATEUR.md'];
      if (!allowedFiles.includes(filename)) {
        return res.status(400).json({ message: "Fichier non autorisé" });
      }
      
      const filePath = path.join(process.cwd(), filename);
      const content = await fs.readFile(filePath, 'utf-8');
      
      return res.status(200).json({ content, filename });
    } catch (error) {
      console.error("Error reading documentation file:", error);
      return res.status(500).json({ message: "Erreur lors de la lecture du fichier" });
    }
  });

  app.get("/api/documentation", authenticate, isAdmin, async (_req, res) => {
    try {
      return res.status(200).json({
        files: [
          { 
            name: 'GUIDE_UTILISATEUR.md', 
            title: 'Guide Utilisateur',
            description: 'Guide complet d\'utilisation de Yaro FleetOS'
          },
          { 
            name: 'CAHIER_TESTS_UTILISATEUR.md', 
            title: 'Cahier de Tests',
            description: 'Scénarios de tests et parcours utilisateurs'
          }
        ]
      });
    } catch (error) {
      console.error("Error listing documentation:", error);
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Les tâches de fond sont démarrées depuis `server/index.ts` via
  // `startBackgroundJobs()` (voir `server/scheduler.ts`), pas ici.

  const httpServer = createServer(app);

  return httpServer;
}
