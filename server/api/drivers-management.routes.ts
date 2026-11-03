import { Router } from "express";
import { z } from "zod";
import { eq, desc, like } from "drizzle-orm";
import { db } from "../db";
import { drivers, missions, assignments, clients, vehicles, users } from "@shared/schema";
import { authenticate, isAdmin, isDriverManager } from "../middleware/auth";
import { cpcTrainingService } from "../services/cpc-training-service";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { driverScopeOf, OUT_OF_DRIVER_PROFILE_MESSAGE, redactDriverPersonalData, stripDriverPersonalData } from "../lib/driver-scope";

const router = Router();
router.use(authenticate);

const optionalTextField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  });

const optionalDateField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  })
  .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: "Format de date invalide (YYYY-MM-DD)",
  });

const createDriverSchema = z.object({
  firstName: z.string().trim().min(1, "Le prénom est requis"),
  lastName: z.string().trim().min(1, "Le nom est requis"),
  employeeNumber: optionalTextField,
  birthDate: optionalDateField,
  cniNumber: optionalTextField,
  cniExpiry: optionalDateField,
  licenseNumber: optionalTextField,
  licenseExpiry: optionalDateField,
  hireDate: optionalDateField,
  geoTrainingDate: optionalDateField,
  cpcTrainingDate: optionalDateField,
  isActive: z.boolean().optional(),
  userId: z.number().int().positive().nullable().optional(),
});

const updateDriverSchema = createDriverSchema
  .partial()
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "Aucune donnée de mise à jour fournie",
  });

const log = moduleLogger("drivers-management");

const toggleDriverSchema = z.object({
  isActive: z.boolean(),
});

function parseDriverId(rawId: string): number | null {
  const parsed = Number.parseInt(rawId, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return (error as { code?: string }).code === "23505";
}

function broadcastDriverUpdate(
  eventType: "driver_created" | "driver_updated" | "driver_toggled",
  driver: Record<string, any> | null | undefined,
  driverId: number,
): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  broadcastUpdate(eventType, {
    entity: "driver",
    entityId: driverId,
    // Diffusion à tous les profils : ni CNI, ni permis, ni date de naissance. Les écrans
    // resynchronisent par invalidation (useRealTimeSync), ils n'exploitent pas la fiche diffusée.
    payload: { driver: driver ? stripDriverPersonalData(driver) : driver },
    scope: { type: "broadcast" },
  });
}

// GET /api/drivers/me — Profil chauffeur de l'utilisateur connecté + ses missions
router.get("/me", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ message: "Non authentifié" });

    let [driver] = await db
      .select()
      .from(drivers)
      .where(eq(drivers.userId, userId))
      .limit(1);

    // Fallback: si userId n'est pas encore renseigné dans drivers, chercher par le nom du user
    if (!driver) {
      const [currentUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
      if (currentUser?.name) {
        const parts = currentUser.name.trim().split(" ");
        const firstName = parts[0];
        const lastName = parts.slice(1).join(" ");
        const [found] = await db.select().from(drivers)
          .where(eq(drivers.firstName, firstName))
          .limit(1);
        if (found && found.lastName?.toLowerCase() === lastName.toLowerCase()) {
          driver = found;
          // Auto-corriger le lien manquant
          await db.update(drivers).set({ userId }).where(eq(drivers.id, found.id));
        }
      }
    }

    if (!driver) return res.status(404).json({ message: "Profil chauffeur introuvable" });

    // Missions de ce chauffeur via assignments
    const driverMissions = await db
      .select({
        id: missions.id,
        orderNumber: missions.orderNumber,
        status: missions.status,
        pickupAddress: missions.pickupAddress,
        deliveryAddress: missions.deliveryAddress,
        pickupDate: missions.pickupDate,
        deliveryDate: missions.deliveryDate,
        actualDeliveryDate: missions.completedAt,
        actualDepartureDate: assignments.startedAt,
        // Statut de l'affectation (pas de la mission) : l'écran de panne ne propose que les actives.
        assignmentStatus: assignments.status,
        estimatedDistance: missions.estimatedDistance,
        actualDistance: missions.actualDistance,
        clientName: clients.name,
        vehicleRegistration: vehicles.registrationNumber,
        vehicleBrand: vehicles.brand,
        vehicleModel: vehicles.model,
        vehicleId: vehicles.id,
        specialInstructions: missions.specialInstructions,
      })
      .from(assignments)
      .innerJoin(missions, eq(assignments.missionId, missions.id))
      .leftJoin(clients, eq(missions.clientId, clients.id))
      .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id))
      .where(eq(assignments.driverId, driver.id))
      .orderBy(desc(missions.pickupDate));

    console.log(`[driver/me] userId=${userId} → driverId=${driver.id} → ${driverMissions.length} missions (statuts: ${driverMissions.map(m => m.status).join(",")||"aucune"})`);
    return res.status(200).json({ driver, missions: driverMissions });
  } catch (error) {
    console.error("Get driver/me error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/:id/missions", async (req, res) => {
  try {
    const driverId = parseDriverId(req.params.id);
    if (!driverId) return res.status(400).json({ message: "ID de chauffeur invalide" });

    // Un chauffeur ne lit que ses propres missions (DRV2-3) ; le personnel lit celles de tous.
    const driverScope = await driverScopeOf(req.user);
    if (driverScope !== undefined && !driverScope.includes(driverId)) {
      return res.status(403).json({ message: OUT_OF_DRIVER_PROFILE_MESSAGE });
    }

    const rows = await db
      .select({
        id: missions.id,
        orderNumber: missions.orderNumber,
        status: missions.status,
        pickupAddress: missions.pickupAddress,
        deliveryAddress: missions.deliveryAddress,
        pickupDate: missions.pickupDate,
        deliveryDate: missions.deliveryDate,
        clientName: clients.name,
        vehicleRegistration: vehicles.registrationNumber,
        vehicleModel: vehicles.model,
      })
      .from(assignments)
      .innerJoin(missions, eq(assignments.missionId, missions.id))
      .leftJoin(clients, eq(missions.clientId, clients.id))
      .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id))
      .where(eq(assignments.driverId, driverId))
      .orderBy(desc(missions.pickupDate));

    return res.status(200).json(rows);
  } catch (error) {
    console.error("Get driver missions error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const driverId = parseDriverId(req.params.id);
    if (!driverId) {
      return res.status(400).json({ message: "ID de chauffeur invalide" });
    }

    const driver = await cpcTrainingService.getDriverWithCPCStatus(driverId);
    return res.status(200).json(await redactDriverPersonalData(req.user, driver));
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Fiche chauffeur en echec");
    return next(new AppError(500, "Impossible de charger le chauffeur.", { cause: error }));
  }
});

// Création alignée sur la modification (`isDriverManager`): le logisticien
// affecte les chauffeurs aux missions et doit pouvoir enregistrer une arrivée,
// la secrétaire tient les papiers. Restreindre la création à l'admin alors que
// les trois peuvent déjà modifier n'importe quel champ ne protégeait rien.
router.post("/", isDriverManager, async (req, res) => {
  try {
    const parsed = createDriverSchema.parse(req.body);
    const cpcStatus = cpcTrainingService.calculateCPCStatus(parsed.cpcTrainingDate);

    const [createdDriver] = await db
      .insert(drivers)
      .values({
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        employeeNumber: parsed.employeeNumber,
        birthDate: parsed.birthDate,
        cniNumber: parsed.cniNumber,
        cniExpiry: parsed.cniExpiry,
        licenseNumber: parsed.licenseNumber,
        licenseExpiry: parsed.licenseExpiry,
        hireDate: parsed.hireDate,
        geoTrainingDate: parsed.geoTrainingDate,
        cpcTrainingDate: parsed.cpcTrainingDate,
        cpcStatus,
        cpcStatusUpdatedAt: new Date(),
        isActive: parsed.isActive ?? true,
        userId: parsed.userId ?? null,
      })
      .returning();

    const fullDriver = await cpcTrainingService.getDriverWithCPCStatus(createdDriver.id);
    broadcastDriverUpdate("driver_created", fullDriver, createdDriver.id);
    return res.status(201).json(fullDriver);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({
        message: "Matricule ou liaison utilisateur déjà utilisée",
      });
    }

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Données chauffeur invalides",
        errors: error.errors,
      });
    }

    console.error("Create driver error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.patch("/:id", isDriverManager, async (req, res) => {
  try {
    const driverId = parseDriverId(req.params.id);
    if (!driverId) {
      return res.status(400).json({ message: "ID de chauffeur invalide" });
    }

    const parsed = updateDriverSchema.parse(req.body);
    const hasOwn = (key: string) =>
      Object.prototype.hasOwnProperty.call(parsed, key);

    const updateData: Partial<typeof drivers.$inferInsert> = {};

    if (hasOwn("firstName") && parsed.firstName !== undefined) {
      updateData.firstName = parsed.firstName;
    }
    if (hasOwn("lastName") && parsed.lastName !== undefined) {
      updateData.lastName = parsed.lastName;
    }
    if (hasOwn("employeeNumber")) {
      updateData.employeeNumber = parsed.employeeNumber ?? null;
    }
    if (hasOwn("birthDate")) {
      updateData.birthDate = parsed.birthDate ?? null;
    }
    if (hasOwn("cniNumber")) {
      updateData.cniNumber = parsed.cniNumber ?? null;
    }
    if (hasOwn("cniExpiry")) {
      updateData.cniExpiry = parsed.cniExpiry ?? null;
    }
    if (hasOwn("licenseNumber")) {
      updateData.licenseNumber = parsed.licenseNumber ?? null;
    }
    if (hasOwn("licenseExpiry")) {
      updateData.licenseExpiry = parsed.licenseExpiry ?? null;
    }
    if (hasOwn("hireDate")) {
      updateData.hireDate = parsed.hireDate ?? null;
    }
    if (hasOwn("geoTrainingDate")) {
      updateData.geoTrainingDate = parsed.geoTrainingDate ?? null;
    }
    if (hasOwn("isActive") && typeof parsed.isActive === "boolean") {
      updateData.isActive = parsed.isActive;
    }
    if (hasOwn("userId")) {
      updateData.userId = parsed.userId ?? null;
    }

    if (hasOwn("cpcTrainingDate")) {
      const cpcTrainingDate = parsed.cpcTrainingDate ?? null;
      updateData.cpcTrainingDate = cpcTrainingDate;
      updateData.cpcStatus = cpcTrainingService.calculateCPCStatus(cpcTrainingDate);
      updateData.cpcStatusUpdatedAt = new Date();
    }

    const [updatedDriver] = await db
      .update(drivers)
      .set(updateData)
      .where(eq(drivers.id, driverId))
      .returning();

    if (!updatedDriver) {
      return res.status(404).json({ message: "Chauffeur non trouvé" });
    }

    const fullDriver = await cpcTrainingService.getDriverWithCPCStatus(driverId);
    broadcastDriverUpdate("driver_updated", fullDriver, driverId);
    return res.status(200).json(fullDriver);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({
        message: "Matricule ou liaison utilisateur déjà utilisée",
      });
    }

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Données chauffeur invalides",
        errors: error.errors,
      });
    }

    console.error("Update driver error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.patch("/:id/toggle", isDriverManager, async (req, res) => {
  try {
    const driverId = parseDriverId(req.params.id);
    if (!driverId) {
      return res.status(400).json({ message: "ID de chauffeur invalide" });
    }

    const { isActive } = toggleDriverSchema.parse(req.body);

    const [updatedDriver] = await db
      .update(drivers)
      .set({ isActive })
      .where(eq(drivers.id, driverId))
      .returning();

    if (!updatedDriver) {
      return res.status(404).json({ message: "Chauffeur non trouvé" });
    }

    const fullDriver = await cpcTrainingService.getDriverWithCPCStatus(driverId);
    broadcastDriverUpdate("driver_toggled", fullDriver, driverId);
    return res.status(200).json(fullDriver);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Données invalides",
        errors: error.errors,
      });
    }

    console.error("Toggle driver error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.delete("/:id", isAdmin, async (req, res) => {
  try {
    const driverId = parseDriverId(req.params.id);
    if (!driverId) {
      return res.status(400).json({ message: "ID de chauffeur invalide" });
    }

    const [updatedDriver] = await db
      .update(drivers)
      .set({ isActive: false })
      .where(eq(drivers.id, driverId))
      .returning();

    if (!updatedDriver) {
      return res.status(404).json({ message: "Chauffeur non trouvé" });
    }

    const fullDriver = await cpcTrainingService.getDriverWithCPCStatus(driverId);
    broadcastDriverUpdate("driver_toggled", fullDriver, driverId);
    return res.status(200).json({
      message: "Chauffeur désactivé",
      driver: fullDriver,
    });
  } catch (error) {
    console.error("Delete driver error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST /api/drivers/:id/create-user - Créer un compte utilisateur pour un chauffeur
router.post("/:id/create-user", isAdmin, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id, 10);
    const { pin, email } = req.body;

    if (!pin || !/^\d{4}$/.test(String(pin))) {
      return res.status(400).json({ message: "PIN doit être 4 chiffres" });
    }
    if (!email) {
      return res.status(400).json({ message: "Email requis" });
    }

    const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
    if (!driver) return res.status(404).json({ message: "Chauffeur introuvable" });

    // Generate username from name
    const firstName = (driver.firstName || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
    const lastName = (driver.lastName || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
    const baseUsername = `${firstName}.${lastName}`;

    // Check if username exists, add number suffix if needed
    const existingUsers = await db.select({ username: users.username }).from(users).where(like(users.username, `${baseUsername}%`));
    const username = existingUsers.length === 0 ? baseUsername : `${baseUsername}${existingUsers.length}`;

    // Check email uniqueness
    const [existingEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existingEmail) return res.status(400).json({ message: "Cet email est déjà utilisé" });

    // Hash PIN
    const bcrypt = await import("bcryptjs");
    const hashedPin = await bcrypt.hash(String(pin), 10);

    // Create user
    const [newUser] = await db.insert(users).values({
      username,
      password: hashedPin,
      pin: hashedPin,
      email,
      name: `${driver.firstName} ${driver.lastName}`,
      role: "driver",
    }).returning({ id: users.id, username: users.username, name: users.name, role: users.role });

    // Link driver record to the new user account
    await db.update(drivers).set({ userId: newUser.id }).where(eq(drivers.id, driverId));

    return res.status(201).json({ user: newUser, message: `Compte créé: ${username}` });
  } catch (error: any) {
    console.error("Create driver user error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

export default router;
