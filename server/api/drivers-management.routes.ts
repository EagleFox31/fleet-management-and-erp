import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, desc, isNull, like } from "drizzle-orm";
import { db } from "../db";
import { drivers, missions, assignments, clients, vehicles, users } from "@shared/schema";
import { authenticate, isAdmin, isDriverManager } from "../middleware/auth";
import { cpcTrainingService } from "../services/cpc-training-service";
import { AppError } from "../lib/app-error";
import { parseRouteId } from "../lib/route-id";
import { moduleLogger } from "../lib/logger";
import { driverEventScopes } from "../lib/driver-realtime";
import { toFieldErrors } from "@shared/errors";
import { DRIVER_DIRECTORY_READ_ROLES, type AppRole } from "@shared/constants/roles";
import { toExpiryDateOnly } from "@shared/constants/expiry-day";
import { bodyIdSchema } from "@shared/contracts/common";
import { CPC_TRAINING_DATE_FUTURE_MESSAGE, isCpcTrainingDateInFuture } from "../lib/driver-cpc-input";
import { randomPasswordHash } from "../lib/dummy-hash";
// Lit aussi `cause` : Drizzle enveloppe parfois l'erreur du pilote, l'ancien test local ne voyait que `code`.
import { isUniqueViolation } from "../lib/pg-errors";
import { driverLiveAssignmentFilter, driverScopeOf, OUT_OF_DRIVER_PROFILE_MESSAGE, redactDriverPersonalData, stripDriverPersonalData } from "../lib/driver-scope";
import { withLogContext } from "../lib/error-log-context";

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

const DATE_IMPOSSIBLE_MESSAGE = "Date inexistante : vérifiez le jour et le mois";

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
  })
  // Bon format, jour inexistant (9999-99-99, 2026-02-30) ou année 0000 (JavaScript l'accepte, Postgres non) :
  // refusé ici, sinon la base le rejette en 500.
  .refine((value) => value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value) || (!value.startsWith("0000-") && toExpiryDateOnly(value) === value), {
    message: DATE_IMPOSSIBLE_MESSAGE,
  });

// Une formation ne peut pas avoir eu lieu dans le futur (jour UTC). Controle de saisie seulement :
// les imports (scripts/) et les donnees deja en base ne passent pas par ce schema.
const pastOrTodayDateField = optionalDateField.refine(
  (value) => !isCpcTrainingDateInFuture(value),
  { message: CPC_TRAINING_DATE_FUTURE_MESSAGE },
);

const DRIVER_INVALID_MESSAGE = "Données chauffeur invalides";

// Messages ecrits dans les schemas ci-dessous : seuls ceux-la remontent tels quels dans `message`.
// Toute autre issue Zod (type, requis...) garde le message generique.
const SCHEMA_MESSAGES: ReadonlySet<string> = new Set([
  "Le prénom est requis",
  "Le nom est requis",
  "Format de date invalide (YYYY-MM-DD)",
  DATE_IMPOSSIBLE_MESSAGE,
  "Aucune donnée de mise à jour fournie",
  CPC_TRAINING_DATE_FUTURE_MESSAGE,
]);

/** Corps 400 au contrat ApiErrorBody : détail par champ en français, jamais de texte Zod par défaut. */
function driverValidationBody(error: z.ZodError) {
  const custom = error.issues.find((issue) => SCHEMA_MESSAGES.has(issue.message));
  return {
    message: custom ? custom.message : DRIVER_INVALID_MESSAGE,
    code: "VALIDATION" as const,
    errors: toFieldErrors(error.issues),
  };
}

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
  cpcTrainingDate: pastOrTodayDateField,
  isActive: z.boolean().optional(),
  userId: bodyIdSchema.nullable().optional(),
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


function broadcastDriverUpdate(
  eventType: "driver_created" | "driver_updated" | "driver_toggled",
  driver: Record<string, any> | null | undefined,
  driverId: number,
): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  for (const scope of driverEventScopes(driver?.userId)) broadcastUpdate(eventType, {
    entity: "driver",
    entityId: driverId,
    // Personnel hors chauffeur et chauffeur concerné seuls : ni CNI, ni permis, ni date de naissance. Les écrans
    // resynchronisent par invalidation (useRealTimeSync), ils n'exploitent pas la fiche diffusée.
    payload: { driver: driver ? stripDriverPersonalData(driver) : driver },
    scope,
  });
}

// GET /api/drivers/me — Profil chauffeur de l'utilisateur connecté + ses missions
router.get("/me", async (req, res, next) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ message: "Non authentifié" });

    // Fiche liée par le personnel seulement (#113) : plus de repli par nom, qui liait le compte au
    // premier homonyme venu. Une fiche par compte au plus (index uq_drivers_user_id).
    const [driver] = await db
      .select()
      .from(drivers)
      .where(eq(drivers.userId, userId))
      .limit(1);

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
      // Affectations vivantes seulement : un chauffeur retiré (annulée, refusée) ne voit plus la mission (#240).
      .where(driverLiveAssignmentFilter([driver.id]))
      .orderBy(desc(missions.pickupDate));

    log.debug({ requestId: req.requestId, driverId: driver.id, missionCount: driverMissions.length }, "Missions du chauffeur connecté lues");
    return res.status(200).json({ driver, missions: driverMissions });
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Lecture du chauffeur connecté en echec");
    return next(new AppError(500, "Impossible de charger votre fiche chauffeur.", { cause: error }));
  }
});

/**
 * Annuaire des chauffeurs (moindre donnée) : le chauffeur ne lit que sa propre fiche, le reste du
 * personnel passe par DRIVER_DIRECTORY_READ_ROLES (ni technicien ni autre chauffeur).
 */
const driverSelfOrDirectory = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const role = req.user?.role as AppRole | undefined;
    if (role === "driver") {
      const driverId = parseRouteId(req.params.id, "ID de chauffeur invalide");
      const driverScope = await driverScopeOf(req.user);
      if (!driverScope?.includes(driverId)) throw new AppError(403, OUT_OF_DRIVER_PROFILE_MESSAGE);
      return next();
    }
    if (!role || !DRIVER_DIRECTORY_READ_ROLES.includes(role)) throw new AppError(403, "Accès non autorisé");
    next();
  } catch (error) {
    next(error);
  }
};

router.get("/:id/missions", driverSelfOrDirectory, async (req, res, next) => {
  try {
    const driverId = parseRouteId(req.params.id, "ID de chauffeur invalide");

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
      .where(driverLiveAssignmentFilter([driverId]))
      .orderBy(desc(missions.pickupDate));

    return res.status(200).json(rows);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "Lecture des missions du chauffeur en echec");
    return next(new AppError(500, "Impossible de charger les missions du chauffeur.", { cause: error }));
  }
});

router.get("/:id", driverSelfOrDirectory, async (req, res, next) => {
  try {
    const driverId = parseRouteId(req.params.id, "ID de chauffeur invalide");

    const driver = await cpcTrainingService.getDriverWithCPCStatus(driverId);
    return res.status(200).json(await redactDriverPersonalData(req.user, driver));
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(withLogContext(new AppError(500, "Impossible de charger le chauffeur.", { cause: error }), { event: "Fiche chauffeur en echec" }));
  }
});

// Création alignée sur la modification (`isDriverManager`): le logisticien
// affecte les chauffeurs aux missions et doit pouvoir enregistrer une arrivée,
// la secrétaire tient les papiers. Restreindre la création à l'admin alors que
// les trois peuvent déjà modifier n'importe quel champ ne protégeait rien.
router.post("/", isDriverManager, async (req, res, next) => {
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
      return res.status(400).json(driverValidationBody(error));
    }

    log.error({ err: error, requestId: req.requestId }, "Creation du chauffeur en echec");
    return next(new AppError(500, "Impossible de créer le chauffeur.", { cause: error }));
  }
});

router.patch("/:id", isDriverManager, async (req, res, next) => {
  try {
    const driverId = parseRouteId(req.params.id, "ID de chauffeur invalide");

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
    if (error instanceof AppError) return next(error);
    if (isUniqueViolation(error)) {
      return res.status(409).json({
        message: "Matricule ou liaison utilisateur déjà utilisée",
      });
    }

    if (error instanceof z.ZodError) {
      return res.status(400).json(driverValidationBody(error));
    }

    log.error({ err: error, requestId: req.requestId }, "Mise a jour du chauffeur en echec");
    return next(new AppError(500, "Impossible de mettre à jour le chauffeur.", { cause: error }));
  }
});

router.patch("/:id/toggle", isDriverManager, async (req, res, next) => {
  try {
    const driverId = parseRouteId(req.params.id, "ID de chauffeur invalide");

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
    if (error instanceof AppError) return next(error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Données invalides",
        errors: error.errors,
      });
    }

    log.error({ err: error, requestId: req.requestId }, "Bascule d'activation du chauffeur en echec");
    return next(new AppError(500, "Impossible de modifier l'activation du chauffeur.", { cause: error }));
  }
});

router.delete("/:id", isAdmin, async (req, res, next) => {
  try {
    const driverId = parseRouteId(req.params.id, "ID de chauffeur invalide");

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
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "Desactivation du chauffeur en echec");
    return next(new AppError(500, "Impossible de désactiver le chauffeur.", { cause: error }));
  }
});

const DRIVER_ALREADY_LINKED = "Ce chauffeur a déjà un compte utilisateur";
class DriverAlreadyLinkedError extends Error {}

// POST /api/drivers/:id/create-user - Créer un compte utilisateur pour un chauffeur
router.post("/:id/create-user", isAdmin, async (req, res, next) => {
  try {
    const driverId = parseRouteId(req.params.id, "ID de chauffeur invalide");
    const { pin, email } = req.body;

    if (!pin || !/^\d{4}$/.test(String(pin))) {
      return res.status(400).json({ message: "PIN doit être 4 chiffres" });
    }
    if (!email) {
      return res.status(400).json({ message: "Email requis" });
    }

    const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
    if (!driver) return res.status(404).json({ message: "Chauffeur introuvable" });
    // #113 : ne jamais écraser une liaison existante (l'ancien compte resterait sans fiche).
    if (driver.userId !== null) return res.status(409).json({ message: DRIVER_ALREADY_LINKED });

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

    // Compte et liaison dans une même transaction : une liaison refusée n'y laisse pas de compte orphelin.
    // La liaison ne vise qu'une fiche encore sans compte (course entre deux créations).
    const newUser = await db.transaction(async (tx) => {
      const [created] = await tx.insert(users).values({
        username,
        // Mot de passe aléatoire, jamais communiqué : le chauffeur se connecte par PIN seulement.
        password: await randomPasswordHash(),
        pin: hashedPin,
        email,
        name: `${driver.firstName} ${driver.lastName}`,
        role: "driver",
      }).returning({ id: users.id, username: users.username, name: users.name, role: users.role });

      const linked = await tx
        .update(drivers)
        .set({ userId: created.id })
        .where(and(eq(drivers.id, driverId), isNull(drivers.userId)))
        .returning({ id: drivers.id });
      if (linked.length === 0) throw new DriverAlreadyLinkedError();
      return created;
    });

    // Temps réel (AGENTS §2) : la fiche a désormais un compte, les autres profils resynchronisent.
    // Best effort : compte créé et lié, un échec ici ne doit pas renvoyer 500 (le nouvel essai
    // répondrait 409 « déjà lié »). Les autres profils resynchronisent alors au refetch.
    try {
      const fullDriver = await cpcTrainingService.getDriverWithCPCStatus(driverId);
      broadcastDriverUpdate("driver_updated", fullDriver, driverId);
    } catch (err) {
      log.error({ err, requestId: req.requestId, driverId }, "Diffusion apres creation du compte chauffeur en echec");
    }

    return res.status(201).json({ user: newUser, message: `Compte créé: ${username}` });
  } catch (error: any) {
    if (error instanceof AppError) return next(error);
    if (error instanceof DriverAlreadyLinkedError) {
      return res.status(409).json({ message: DRIVER_ALREADY_LINKED });
    }
    // Dernier rempart : identifiant, email ou liaison pris entre la vérification et l'écriture.
    if (isUniqueViolation(error)) {
      return res.status(409).json({ message: "Identifiant, email ou liaison utilisateur déjà utilisé" });
    }
    log.error({ err: error, requestId: req.requestId, driverId: req.params.id }, "Creation du compte chauffeur en echec");
    return next(new AppError(500, "Impossible de créer le compte du chauffeur.", { cause: error }));
  }
});

export default router;
