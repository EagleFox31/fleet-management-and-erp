import { db } from "../db";
import { tires, vehicleTires, vehicles, tireInspections, tireRotations, tireRotationDetails, users, workOrders } from "@shared/schema";
import { eq, desc, and, sql, like, isNull, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { activityLogger } from "./activity-logger";
import type { Tire, InsertTire, VehicleTire, InsertVehicleTire } from "@shared/schema";
import { ownedLiveVehicles } from "../lib/client-vehicle-scope";
import { computeTireWearScore } from "@shared/constants/tires";
import { vehicleTireStatusAfterRemoval, type TireRemoval } from "@shared/constants/tire-removal";
import { usedTiresLabel } from "@shared/constants/tire-stock";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { preventiveDueDay } from "../lib/kpi-rules";
import { stampPreventiveDue } from "../lib/preventive-due";

import { PART_CATALOG_EVENT_ROLES, STAFF_ROLES } from "@shared/constants/roles";
const log = moduleLogger("tires");

const createdByUser = alias(users, "tires_created_by_user");
const updatedByUser = alias(users, "tires_updated_by_user");

type TireRealtimeEvent =
  | "tire_created"
  | "tire_updated"
  | "tire_deleted"
  | "vehicle_tire_installed"
  | "vehicle_tire_removed";

/**
 * Diffusion temps réel des transitions pneus.
 *
 * Le module est partagé entre deux métiers: le magasin gère le catalogue
 * (réception, quantités) et l'atelier le montage sur véhicule. Un changement
 * d'un côté doit être visible de l'autre sans rafraîchissement — d'où un scope
 * `broadcast`, jamais restreint à l'utilisateur qui déclenche l'action.
 *
 * Le garde sur le type protège le démarrage: le WebSocket n'est pas encore
 * initialisé quand les premiers appels de service peuvent survenir.
 */
function broadcastTireUpdate(
  eventType: TireRealtimeEvent,
  entityId: number | null,
  payload: Record<string, unknown>,
): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  broadcastUpdate(eventType, {
    entity: eventType.startsWith("vehicle_tire") ? "vehicle_tire" : "tire",
    entityId,
    payload,
    // La fiche pneu porte le prix d'achat : hors chauffeur. Montage et démontage (sans prix) : tout le personnel.
    scope: {
      type: "roles",
      roles: eventType.startsWith("vehicle_tire") ? [...STAFF_ROLES] : [...PART_CATALOG_EVENT_ROLES],
    },
  });
}

export class TiresService {
  // Fonction pour traduire les positions de pneus
  private translatePosition(position: string): string {
    const translations: Record<string, string> = {
      'front_left': 'Avant gauche',
      'front_right': 'Avant droit',
      'rear_left_inner': 'Arrière gauche intérieur',
      'rear_left_outer': 'Arrière gauche extérieur',
      'rear_right_inner': 'Arrière droit intérieur',
      'rear_right_outer': 'Arrière droit extérieur',
      'spare': 'Roue de secours'
    };
    return translations[position] || position;
  }

  // CRUD Operations for Tires
  async getTire(id: number): Promise<Tire | undefined> {
    try {
      const [result] = await db
        .select({
          tire: tires,
          createdByName: createdByUser.name,
          updatedByName: updatedByUser.name,
        })
        .from(tires)
        .leftJoin(createdByUser, eq(tires.createdBy, createdByUser.id))
        .leftJoin(updatedByUser, eq(tires.updatedBy, updatedByUser.id))
        .where(and(eq(tires.id, id), isNull(tires.deletedAt)));

      if (!result) {
        return undefined;
      }

      return {
        ...result.tire,
        createdByName: result.createdByName,
        updatedByName: result.updatedByName,
      } as Tire;
    } catch (error) {
      log.error({ err: error, tireId: id }, "lecture de la fiche pneu en échec");
      return undefined;
    }
  }

  async getTires(filters?: {
    brand?: string;
    model?: string;
    size?: string;
    location?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ tires: Tire[]; total: number }> {
    try {
      console.log('getTires called - fetching from PostgreSQL...');
      
      const conditions = [isNull(tires.deletedAt)];
      
      // Apply filters
      if (filters?.brand) {
        conditions.push(like(tires.brand, `%${filters.brand}%`));
      }
      
      if (filters?.model) {
        conditions.push(like(tires.model, `%${filters.model}%`));
      }
      
      if (filters?.size) {
        conditions.push(like(tires.size, `%${filters.size}%`));
      }
      
      if (filters?.location) {
        conditions.push(like(tires.location, `%${filters.location}%`));
      }

      const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

      // Get total count
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(tires)
        .where(whereClause);
      const total = countResult[0]?.count || 0;

      // Get paginated results
      const baseQuery = db
        .select()
        .from(tires)
        .where(whereClause)
        .orderBy(desc(tires.createdAt));

      const limit = typeof filters?.limit === 'number' ? filters.limit : undefined;
      const offset = typeof filters?.offset === 'number' ? filters.offset : undefined;

      const tiresResult =
        typeof limit === 'number' && typeof offset === 'number'
          ? await baseQuery.limit(limit).offset(offset)
          : typeof limit === 'number'
            ? await baseQuery.limit(limit)
            : typeof offset === 'number'
              ? await baseQuery.offset(offset)
              : await baseQuery;
      
      console.log(`Tires retrieved from DB: ${tiresResult.length} items, total: ${total}`);

      const auditUserIds = Array.from(
        new Set(
          tiresResult
            .flatMap((tire) => [tire.createdBy, tire.updatedBy])
            .filter((value): value is number => typeof value === "number" && value > 0),
        ),
      );
      const userNameById = new Map<number, string>();

      if (auditUserIds.length > 0) {
        const userRows = await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, auditUserIds));

        for (const user of userRows) {
          userNameById.set(user.id, user.name);
        }
      }

      const tiresWithAudit = tiresResult.map((tire) => ({
        ...tire,
        createdByName:
          typeof tire.createdBy === "number" ? userNameById.get(tire.createdBy) ?? null : null,
        updatedByName:
          typeof tire.updatedBy === "number" ? userNameById.get(tire.updatedBy) ?? null : null,
      }));
      
      return {
        tires: tiresWithAudit,
        total
      };
    } catch (error) {
      console.error('Error getting tires:', error);
      return { tires: [], total: 0 };
    }
  }

  async createTire(tire: InsertTire, createdBy?: number): Promise<Tire> {
    try {
      const now = new Date();
      const [newTire] = await db
        .insert(tires)
        .values({
          ...tire,
          // L'usagé naît d'un démontage, jamais d'une création de fiche.
          usedStockQuantity: 0,
          createdBy: createdBy ?? null,
          updatedBy: createdBy ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      
      console.log(`✅ Tire created: ${newTire.brand} ${newTire.model} (${newTire.size})`);

      broadcastTireUpdate("tire_created", newTire.id, { tire: newTire, tireId: newTire.id });

      return newTire;
    } catch (error) {
      console.error('Error creating tire:', error);
      throw error;
    }
  }

  async updateTire(
    id: number,
    tire: Partial<InsertTire>,
    updatedBy?: number,
  ): Promise<Tire | undefined> {
    // Une fiche supprimée (douce) n'est plus modifiable : `undefined`, comme une fiche inexistante.
    const [updatedTire] = await db
      .update(tires)
      .set({
        ...tire,
        updatedBy: updatedBy ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(tires.id, id), isNull(tires.deletedAt)))
      .returning();

    if (updatedTire) {
      log.info({ tireId: id }, "fiche pneu modifiée");
      broadcastTireUpdate("tire_updated", updatedTire.id, {
        tire: updatedTire,
        tireId: updatedTire.id,
      });
    }

    return updatedTire;
  }

  async deleteTire(id: number, userId?: number): Promise<boolean> {
    try {
      // Récupérer les données du pneu avant suppression pour les logs
      const [tireData] = await db
        .select()
        .from(tires)
        .where(and(
          eq(tires.id, id),
          isNull(tires.deletedAt)
        ));
      
      if (!tireData) {
        throw new AppError(404, "Ce pneu n'existe pas ou a déjà été supprimé.");
      }
      
      // Vérifier si le pneu est installé sur un véhicule
      const [vehicleTire] = await db
        .select()
        .from(vehicleTires)
        .where(and(
          eq(vehicleTires.tireId, id),
          eq(vehicleTires.status, 'active')
        ));
      
      if (vehicleTire) {
        throw new AppError(409, "Ce pneu est monté sur un véhicule : démontez-le avant de le supprimer.");
      }
      
      // Soft delete : marquer comme supprimé
      await db
        .update(tires)
        .set({ 
          deletedAt: new Date(),
          updatedBy: userId ?? null,
          updatedAt: new Date()
        })
        .where(eq(tires.id, id));
      
      // Enregistrer dans les logs
      try {
        await activityLogger.logDelete({
          userId,
          entityType: 'tire',
          entityId: id,
          entityData: {
            brand: tireData.brand,
            model: tireData.model,
            size: tireData.size,
            stockQuantity: tireData.stockQuantity,
            purchasePrice: tireData.purchasePrice
          }
        });
      } catch (logError) {
        console.warn('Erreur lors de l\'enregistrement du log:', logError);
      }
      
      console.log(`✅ Tire soft deleted: ID ${id} (${tireData.brand} ${tireData.model})`);

      broadcastTireUpdate("tire_deleted", id, {
        tireId: id,
        brand: tireData.brand,
        model: tireData.model,
      });

      return true;
    } catch (error) {
      if (!(error instanceof AppError)) log.error({ err: error, tireId: id }, "suppression de pneu en échec");
      throw error;
    }
  }

  // Vehicle Tires Management - Version simplifiée
  /** `ownerId` : propriétaire imposé à un client (`ownerScopeOf`), `null` pour le personnel (pas de filtre). Client : véhicules retirés exclus. */
  async getAllVehicleTires(ownerId: number | null = null): Promise<any[]> {
    try {
      log.debug("getAllVehicleTires called - using simplified PostgreSQL methods");

      const rows = await db
        .select({
          id: vehicleTires.id,
          vehicleId: vehicleTires.vehicleId,
          tireId: vehicleTires.tireId,
          position: vehicleTires.position,
          installationDate: vehicleTires.installationDate,
          installationMileage: vehicleTires.installationMileage,
          currentTreadDepth: vehicleTires.currentTreadDepth,
          initialTreadDepth: vehicleTires.initialTreadDepth,
          currentPressure: vehicleTires.currentPressure,
          recommendedPressure: vehicleTires.recommendedPressure,
          status: vehicleTires.status,
          vehicleRegistration: vehicles.registrationNumber,
          tireBrand: tires.brand,
          tireModel: tires.model,
          tireSize: tires.size,
        })
        .from(vehicleTires)
        .leftJoin(tires, eq(vehicleTires.tireId, tires.id))
        .leftJoin(vehicles, eq(vehicleTires.vehicleId, vehicles.id))
        .where(and(eq(vehicleTires.status, "active"), ownedLiveVehicles(ownerId)))
        .orderBy(desc(vehicleTires.installationDate));

      return rows.map((row) => ({
        ...row,
        wearScore: computeTireWearScore(row.currentTreadDepth, row.initialTreadDepth),
      }));
    } catch (error) {
      log.error({ err: error }, "lecture des pneus montés en échec");
      return [];
    }
  }

  async getVehicleTires(vehicleId: number): Promise<any[]> {
    try {
      console.log('getVehicleTires called - using simplified PostgreSQL methods');
      
      const result = await db
        .select()
        .from(vehicleTires)
        .leftJoin(tires, eq(vehicleTires.tireId, tires.id))
        .leftJoin(vehicles, eq(vehicleTires.vehicleId, vehicles.id))
        .where(eq(vehicleTires.vehicleId, vehicleId))
        .orderBy(desc(vehicleTires.installationDate));
      
      return result;
    } catch (error) {
      console.error('Error getting vehicle tires:', error);
      return [];
    }
  }

  async installTireOnVehicle(data: InsertVehicleTire): Promise<any> {
    try {
      const newVehicleTire = await db.transaction(async (tx) => {
        const [occupied] = await tx
          .select({ id: vehicleTires.id })
          .from(vehicleTires)
          .where(
            and(
              eq(vehicleTires.vehicleId, data.vehicleId),
              eq(vehicleTires.position, data.position),
              eq(vehicleTires.status, "active"),
            ),
          )
          .limit(1);

        if (occupied) {
          throw new Error("POSITION_OCCUPIED");
        }

        // Neuf par défaut ; l'usagé se choisit explicitement, jamais en repli implicite.
        const source = data.stockSource ?? "new";
        const column = source === "used" ? tires.usedStockQuantity : tires.stockQuantity;

        // Décrément atomique gardé : deux montages concurrents sur la dernière unité, un seul passe.
        const [updatedTire] = await tx
          .update(tires)
          .set(
            source === "used"
              ? { usedStockQuantity: sql`${column} - 1`, updatedAt: new Date() }
              : { stockQuantity: sql`${column} - 1`, updatedAt: new Date() },
          )
          .where(and(eq(tires.id, data.tireId), isNull(tires.deletedAt), sql`${column} > 0`))
          .returning({ id: tires.id });

        if (!updatedTire) {
          const [tireRow] = await tx
            .select({ stockQuantity: tires.stockQuantity, usedStockQuantity: tires.usedStockQuantity })
            .from(tires)
            .where(and(eq(tires.id, data.tireId), isNull(tires.deletedAt)))
            .limit(1);
          if (!tireRow) throw new Error("INSUFFICIENT_STOCK");
          if (source === "new" && tireRow.usedStockQuantity > 0) {
            throw new AppError(
              409,
              `Aucun pneu neuf de cette référence en stock ; ${usedTiresLabel(tireRow.usedStockQuantity)} disponible(s) : choisissez Usagé pour le monter.`,
            );
          }
          if (source === "used") {
            throw new AppError(409, "Aucun pneu usagé de cette référence en stock.");
          }
          throw new Error("INSUFFICIENT_STOCK");
        }

        const [inserted] = await tx.insert(vehicleTires).values({ ...data, stockSource: source }).returning();
        return inserted;
      });

      log.info({ vehicleTireId: newVehicleTire.id, tireId: newVehicleTire.tireId, stockSource: newVehicleTire.stockSource }, "pneu monté sur véhicule");

      broadcastTireUpdate("vehicle_tire_installed", newVehicleTire.id, {
        vehicleTire: newVehicleTire,
        vehicleTireId: newVehicleTire.id,
        vehicleId: newVehicleTire.vehicleId,
        tireId: newVehicleTire.tireId,
      });

      return newVehicleTire;
    } catch (error) {
      if (!(error instanceof AppError)) log.error({ err: error, tireId: data.tireId }, "montage de pneu en échec");
      throw error;
    }
  }

  async updateVehicleTire(id: number, data: Partial<InsertVehicleTire>): Promise<any> {
    try {
      const [updatedVehicleTire] = await db
        .update(vehicleTires)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(vehicleTires.id, id))
        .returning();
      
      console.log(`✅ Vehicle tire updated: ID ${id}`);
      
      return updatedVehicleTire;
    } catch (error) {
      console.error('Error updating vehicle tire:', error);
      return undefined;
    }
  }

  /**
   * Démonte le pneu et applique sa destination (`TireRemoval`) dans la même transaction :
   * remis en stock, la fiche gagne une unité usagée (le pneu a roulé) ; mis au rebut, le stock ne bouge pas.
   * `false` si le montage n'existe pas ou n'est plus actif (déjà démonté).
   */
  async removeTireFromVehicle(vehicleTireId: number, removal: TireRemoval, userId?: number): Promise<boolean> {
    const removed = await db.transaction(async (tx) => {
      // Un pneu ne roule pas à l'envers : démonté avant son kilométrage de montage, la saisie est fausse.
      const [mounted] = await tx
        .select({ installationMileage: vehicleTires.installationMileage })
        .from(vehicleTires)
        .where(and(eq(vehicleTires.id, vehicleTireId), eq(vehicleTires.status, 'active')))
        .for('update');
      if (
        mounted?.installationMileage != null &&
        removal.removalMileage !== undefined &&
        removal.removalMileage < mounted.installationMileage
      ) {
        const km = (value: number) => `${value.toLocaleString("fr-FR")} km`;
        throw new AppError(
          400,
          `Le kilométrage de démontage (${km(removal.removalMileage)}) est inférieur à celui du montage (${km(mounted.installationMileage)}).`,
          { fieldErrors: [{ field: "removalMileage", message: `Au moins ${km(mounted.installationMileage)}` }] },
        );
      }

      const [row] = await tx
        .update(vehicleTires)
        .set({
          status: vehicleTireStatusAfterRemoval(removal),
          removalDate: new Date().toISOString().split('T')[0],
          removalMileage: removal.removalMileage,
          removalReason: removal.removalReason || null,
          updatedAt: new Date()
        })
        .where(and(eq(vehicleTires.id, vehicleTireId), eq(vehicleTires.status, 'active')))
        .returning({ id: vehicleTires.id, vehicleId: vehicleTires.vehicleId, tireId: vehicleTires.tireId });

      if (!row || removal.destination !== "stock") return row;

      const [restocked] = await tx
        .update(tires)
        .set({
          usedStockQuantity: sql`${tires.usedStockQuantity} + 1`,
          updatedBy: userId ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(tires.id, row.tireId), isNull(tires.deletedAt)))
        .returning({ id: tires.id });

      if (!restocked) {
        throw new AppError(409, "La fiche de ce pneu a été supprimée : il ne peut pas revenir en stock. Choisissez la mise au rebut.");
      }
      return row;
    });

    if (!removed) return false;

    log.info({ vehicleTireId, destination: removal.destination, tireId: removed.tireId }, "pneu démonté du véhicule");

    broadcastTireUpdate("vehicle_tire_removed", vehicleTireId, {
      vehicleTireId,
      vehicleId: removed.vehicleId,
      tireId: removed.tireId,
      destination: removal.destination,
      mileageAtRemoval: removal.removalMileage ?? null,
    });

    return true;
  }

  // Méthodes pour les inspections de pneus
  async getTireInspections(): Promise<any[]> {
    try {
      const inspections = await db
        .select({
          id: tireInspections.id,
          vehicleTireId: tireInspections.vehicleTireId,
          inspectionDate: tireInspections.inspectionDate,
          inspectionMileage: tireInspections.inspectionMileage,
          treadDepth: tireInspections.treadDepth,
          pressure: tireInspections.pressure,
          wearPattern: tireInspections.wearPattern,
          condition: tireInspections.condition,
          hasDefects: tireInspections.hasDefects,
          defectDescription: tireInspections.defectDescription,
          recommendedAction: tireInspections.recommendedAction,
          inspectedBy: tireInspections.inspectedBy,
          nextInspectionDate: tireInspections.nextInspectionDate,
          notes: tireInspections.notes,
          createdAt: tireInspections.createdAt,
          // Données du véhicule et du pneu
          vehicleId: vehicleTires.vehicleId,
          vehicleRegistration: vehicles.registrationNumber,
          vehicleBrand: vehicles.brand,
          vehicleModel: vehicles.model,
          tireBrand: tires.brand,
          tireModel: tires.model,
          tireSize: tires.size,
          tireDotCode: tires.dotCode,
          position: vehicleTires.position,
          // Nom de l'inspecteur
          inspectorName: users.name
        })
        .from(tireInspections)
        .leftJoin(vehicleTires, eq(tireInspections.vehicleTireId, vehicleTires.id))
        .leftJoin(vehicles, eq(vehicleTires.vehicleId, vehicles.id))
        .leftJoin(tires, eq(vehicleTires.tireId, tires.id))
        .leftJoin(users, eq(tireInspections.inspectedBy, users.id))
        .orderBy(desc(tireInspections.inspectionDate));
      
      // Traduire les positions en français
      const translatedInspections = inspections.map(inspection => ({
        ...inspection,
        position: this.translatePosition(inspection.position || ''),
        positionRaw: inspection.position
      }));
      
      console.log(`getTireInspections called - fetched ${translatedInspections.length} inspections`);
      
      return translatedInspections;
    } catch (error) {
      console.error('Error getting tire inspections:', error);
      return [];
    }
  }

  // Obtenir le détail d'une inspection par ID
  async getInspectionById(id: number): Promise<any | null> {
    try {
      const [inspection] = await db
        .select({
          id: tireInspections.id,
          vehicleTireId: tireInspections.vehicleTireId,
          inspectionDate: tireInspections.inspectionDate,
          inspectionMileage: tireInspections.inspectionMileage,
          treadDepth: tireInspections.treadDepth,
          pressure: tireInspections.pressure,
          wearPattern: tireInspections.wearPattern,
          condition: tireInspections.condition,
          hasDefects: tireInspections.hasDefects,
          defectDescription: tireInspections.defectDescription,
          recommendedAction: tireInspections.recommendedAction,
          inspectedBy: tireInspections.inspectedBy,
          nextInspectionDate: tireInspections.nextInspectionDate,
          notes: tireInspections.notes,
          createdAt: tireInspections.createdAt,
          // Données du véhicule
          vehicleId: vehicleTires.vehicleId,
          vehicleRegistration: vehicles.registrationNumber,
          vehicleBrand: vehicles.brand,
          vehicleModel: vehicles.model,
          // Données du pneu
          tireId: vehicleTires.tireId,
          tireBrand: tires.brand,
          tireModel: tires.model,
          tireSize: tires.size,
          tireDotCode: tires.dotCode,
          position: vehicleTires.position,
          installationDate: vehicleTires.installationDate,
          installationMileage: vehicleTires.installationMileage,
          // Inspecteur
          inspectorName: users.name,
          inspectorUsername: users.username
        })
        .from(tireInspections)
        .leftJoin(vehicleTires, eq(tireInspections.vehicleTireId, vehicleTires.id))
        .leftJoin(vehicles, eq(vehicleTires.vehicleId, vehicles.id))
        .leftJoin(tires, eq(vehicleTires.tireId, tires.id))
        .leftJoin(users, eq(tireInspections.inspectedBy, users.id))
        .where(eq(tireInspections.id, id));
      
      if (!inspection) return null;
      
      return {
        ...inspection,
        position: this.translatePosition(inspection.position || ''),
        positionRaw: inspection.position
      };
    } catch (error) {
      console.error('Error getting inspection by ID:', error);
      return null;
    }
  }

  async getVehicleTire(vehicleId: number, position: string): Promise<any> {
    try {
      const [result] = await db
        .select()
        .from(vehicleTires)
        .leftJoin(tires, eq(vehicleTires.tireId, tires.id))
        .where(and(
          eq(vehicleTires.vehicleId, vehicleId),
          eq(vehicleTires.position, position as any),
          eq(vehicleTires.status, 'active')
        ));
      
      return result;
    } catch (error) {
      console.error('Error getting vehicle tire:', error);
      return undefined;
    }
  }

  async createTireInspection(inspectionData: any): Promise<any> {
    try {
      const [newInspection] = await db
        .insert(tireInspections)
        .values({
          vehicleTireId: inspectionData.vehicleTireId,
          inspectionDate: inspectionData.inspectionDate,
          inspectionMileage: inspectionData.inspectionMileage || 0,
          treadDepth: inspectionData.treadDepth,
          pressure: inspectionData.pressure,
          wearPattern: inspectionData.wearPattern,
          condition: inspectionData.condition,
          hasDefects: inspectionData.hasDefects || false,
          defectDescription: inspectionData.defectDescription,
          recommendedAction: inspectionData.recommendedAction,
          inspectedBy: inspectionData.inspectedBy,
          nextInspectionDate: inspectionData.nextInspectionDate,
          notes: inspectionData.notes
        })
        .returning();
      
      log.info({ vehicleTireId: inspectionData.vehicleTireId }, "inspection de pneu créée");

      return newInspection;
    } catch (error) {
      log.error({ err: error, vehicleTireId: inspectionData.vehicleTireId }, "création d'inspection de pneu en échec");
      throw new Error('Erreur lors de la création de l\'inspection');
    }
  }

  // Méthodes pour la gestion des rotations de pneus
  async getTireRotations(): Promise<any[]> {
    try {
      const rotations = await db
        .select({
          id: tireRotations.id,
          vehicleId: tireRotations.vehicleId,
          rotationDate: tireRotations.rotationDate,
          rotationMileage: tireRotations.rotationMileage,
          rotationType: tireRotations.rotationType,
          performedBy: tireRotations.performedBy,
          cost: tireRotations.cost,
          nextRotationMileage: tireRotations.nextRotationMileage,
          notes: tireRotations.notes,
          createdAt: tireRotations.createdAt,
          // Données du véhicule
          vehicleRegistration: vehicles.registrationNumber,
          vehicleBrand: vehicles.brand,
          vehicleModel: vehicles.model
        })
        .from(tireRotations)
        .leftJoin(vehicles, eq(tireRotations.vehicleId, vehicles.id))
        .orderBy(desc(tireRotations.rotationDate));
      
      console.log(`getTireRotations called - fetched ${rotations.length} rotations`);
      
      return rotations;
    } catch (error) {
      console.error('Error getting tire rotations:', error);
      return [];
    }
  }

  async createTireRotation(data: any): Promise<any> {
    try {
      // 1. Récupérer les informations du véhicule pour le titre de l'ordre de travail
      const [vehicle] = await db
        .select({
          registrationNumber: vehicles.registrationNumber,
          brand: vehicles.brand,
          model: vehicles.model
        })
        .from(vehicles)
        .where(eq(vehicles.id, data.vehicleId));
      
      if (!vehicle) {
        throw new AppError(404, "Ce véhicule n'existe pas ou a été supprimé.");
      }
      
      // 2. Traduire le type de rotation pour le titre (aligné avec le frontend)
      const rotationTypeLabels: Record<string, string> = {
        'front_to_back': 'Avant/Arrière',
        'cross_rotation': 'Croisée',
        'rearward_cross': 'Arrière Croisée',
        'forward_cross': 'Avant Croisée',
        // Legacy values (backward compatibility)
        'front_to_rear': 'Avant/Arrière',
        'cross': 'Croisée',
        'side_to_side': 'Côté à côté',
        'diagonal': 'Diagonale',
        'front_cross': 'Avant Croisée',
        'rear_cross': 'Arrière Croisée'
      };
      const rotationTypeLabel = rotationTypeLabels[data.rotationType] || data.rotationType;
      
      // 3. Créer automatiquement un ordre de travail pour le technicien
      const workOrderTitle = `Rotation de Pneus - ${rotationTypeLabel}`;
      const workOrderDescription = `${data.notes || 'Rotation planifiée'}. Kilométrage: ${data.rotationMileage?.toLocaleString()} km`;
      
      // 4. OT et rotation ensemble : une rotation refusée ne laisse pas d'OT orphelin.
      const { workOrder, rotation } = await db.transaction(async (tx) => {
        const [workOrder] = await tx
          .insert(workOrders)
          .values({
            vehicleId: data.vehicleId,
            technicianId: data.technicianId || null, // Optionnel - peut être assigné plus tard
            title: workOrderTitle,
            description: workOrderDescription,
            status: 'pending',
            priority: 'medium',
            startDate: data.rotationDate ? new Date(data.rotationDate) : null,
            isPreventive: true,
            isFirstVisit: false
          })
          .returning();

        // Échéance figée pour le taux de préventif (CDC #7) ; le kilométrage seulement s'il est valide.
        const dueMileage = Number.isInteger(data.rotationMileage) && data.rotationMileage >= 0 ? data.rotationMileage : null;
        await stampPreventiveDue(tx, workOrder.id, { dueDate: preventiveDueDay(data.rotationDate), dueMileage });

        const [rotation] = await tx
          .insert(tireRotations)
          .values({
            vehicleId: data.vehicleId,
            workOrderId: workOrder.id, // Liaison avec l'ordre de travail créé
            rotationDate: data.rotationDate,
            rotationMileage: data.rotationMileage,
            rotationType: data.rotationType,
            performedBy: data.performedBy,
            cost: data.cost ? data.cost.toString() : null,
            nextRotationMileage: data.nextRotationMileage,
            notes: data.notes,
            createdBy: data.createdBy || "Admin"
          })
          .returning();

        return { workOrder, rotation };
      });

      log.info({ rotationId: rotation.id, workOrderId: workOrder.id, title: workOrderTitle }, "rotation planifiée, OT créé");
      
      // 5. Logger l'activité
      await activityLogger.log({
        action: 'TIRE_ROTATION_PLANNED',
        entityType: 'tire_rotation',
        entityId: rotation.id,
        userId: data.performedBy,
        details: {
          description: `Rotation planifiée pour ${vehicle.registrationNumber} (${vehicle.brand} ${vehicle.model}) - Type: ${rotationTypeLabel}`,
          metadata: {
            rotationId: rotation.id,
            workOrderId: workOrder.id,
            vehicleId: data.vehicleId,
            vehicleRegistration: vehicle.registrationNumber,
            rotationType: data.rotationType,
            rotationMileage: data.rotationMileage
          }
        }
      });
      
      return {
        ...rotation,
        workOrder: workOrder,
        vehicleRegistration: vehicle.registrationNumber,
        vehicleBrand: vehicle.brand,
        vehicleModel: vehicle.model
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      log.error({ err: error, vehicleId: data.vehicleId }, "planification de rotation en échec");
      throw new Error('Erreur lors de la création de la rotation');
    }
  }

  /** Dernière inspection du pneu monté `vehicleTireId` (`null` si aucune). */
  async getLastInspection(vehicleTireId: number): Promise<any | null> {
    try {
      const [row] = await db
        .select()
        .from(tireInspections)
        .where(eq(tireInspections.vehicleTireId, vehicleTireId))
        .orderBy(desc(tireInspections.inspectionDate), desc(tireInspections.id))
        .limit(1);
      return row ?? null;
    } catch (error) {
      log.error({ err: error, vehicleTireId }, "lecture de la dernière inspection en échec");
      throw new Error("Erreur lors de la lecture de l'inspection");
    }
  }

  // Statistiques avancées avec données réelles
  async getTireStatisticsAdvanced(): Promise<any> {
    try {
      // Lancer les calculs en parallèle pour éviter un temps cumulé par aller-retour DB.
      const [stockStats, wearStats, actions] = await Promise.all([
        db
          .select({
            totalQuantity: sql<number>`SUM(${tires.stockQuantity})`,
            totalValue: sql<number>`SUM(${tires.stockQuantity} * ${tires.purchasePrice})`,
            totalTypes: sql<number>`COUNT(*)`
          })
          .from(tires)
          .where(isNull(tires.deletedAt)),
        db
          .select({
            averageWear: sql<number>`AVG(${tireInspections.treadDepth})`,
            criticalWearCount: sql<number>`COUNT(CASE WHEN ${tireInspections.treadDepth} < 3.0 THEN 1 END)`
          })
          .from(tireInspections)
          .leftJoin(vehicleTires, eq(tireInspections.vehicleTireId, vehicleTires.id))
          .where(eq(vehicleTires.status, 'active')),
        this.calculateRequiredActions(),
      ]);

      const stats = stockStats[0];
      const wear = wearStats[0];

      return {
        totalTires: stats.totalQuantity || 0,
        totalValue: stats.totalValue || 0,
        averageWear: wear.averageWear ? Number(wear.averageWear.toFixed(1)) : 0,
        lowStockCount: actions.lowStock.length,
        requiredActions: actions
      };
    } catch (error) {
      // Une erreur de base n'est pas un stock vide : des zéros en 200 passeraient pour de vraies valeurs.
      log.error({ err: error }, "statistiques avancées des pneus en échec");
      throw new AppError(500, "Les statistiques des pneus sont momentanément indisponibles.", { cause: error });
    }
  }

  // Calcul des actions requises
  private async calculateRequiredActions(): Promise<any> {
    const actions = {
      lowStock: [] as any[],
      outOfStock: [] as any[],
      criticalWear: [] as any[],
      rotationDue: [] as any[],
      rotationApproaching: [] as any[]
    };

    const [lowStockTires, criticalWearInspections, vehiclesWithRotations] = await Promise.all([
      db
        .select()
        .from(tires)
        .where(and(
          isNull(tires.deletedAt),
          sql`${tires.stockQuantity} <= ${tires.minStockLevel}`
        )),
      db
        .select({
          inspectionId: tireInspections.id,
          treadDepth: tireInspections.treadDepth,
          vehicleRegistration: vehicles.registrationNumber,
          tireBrand: tires.brand,
          tireModel: tires.model,
          position: vehicleTires.position
        })
        .from(tireInspections)
        .leftJoin(vehicleTires, eq(tireInspections.vehicleTireId, vehicleTires.id))
        .leftJoin(vehicles, eq(vehicleTires.vehicleId, vehicles.id))
        .leftJoin(tires, eq(vehicleTires.tireId, tires.id))
        .where(and(
          sql`${tireInspections.treadDepth} < 3.0`,
          eq(vehicleTires.status, 'active')
        )),
      db
        .select({
          vehicleId: vehicles.id,
          vehicleRegistration: vehicles.registrationNumber,
          currentMileage: vehicles.mileage,
          lastRotationMileage: sql<number>`(
            SELECT rotation_mileage
            FROM tire_rotations
            WHERE vehicle_id = ${vehicles.id}
            ORDER BY rotation_date DESC
            LIMIT 1
          )`,
          nextRotationMileage: sql<number>`(
            SELECT next_rotation_mileage
            FROM tire_rotations
            WHERE vehicle_id = ${vehicles.id}
            ORDER BY rotation_date DESC
            LIMIT 1
          )`
        })
        .from(vehicles)
        .where(eq(vehicles.status, 'operational')),
    ]);

    for (const tire of lowStockTires) {
      if (tire.stockQuantity === 0) {
        actions.outOfStock.push({
          type: 'out_of_stock',
          message: `Stock épuisé : ${tire.brand} ${tire.model}`,
          tire,
          priority: 'critical'
        });
      } else {
        actions.lowStock.push({
          type: 'low_stock',
          message: `Stock faible : ${tire.brand} ${tire.model} (${tire.stockQuantity}/${tire.minStockLevel})`,
          tire,
          priority: 'high'
        });
      }
    }

    for (const inspection of criticalWearInspections) {
      actions.criticalWear.push({
        type: 'critical_wear',
        message: `Usure critique : ${inspection.vehicleRegistration} - ${this.translatePosition(inspection.position ?? 'spare')} (${inspection.treadDepth}mm)`,
        inspection,
        priority: 'critical'
      });
    }

    for (const vehicle of vehiclesWithRotations) {
      if (!vehicle.nextRotationMileage || !vehicle.currentMileage) {
        continue;
      }

      const mileageUntilRotation = vehicle.nextRotationMileage - vehicle.currentMileage;
      if (mileageUntilRotation <= 0) {
        actions.rotationDue.push({
          type: 'rotation_due',
          message: `Rotation dépassée : ${vehicle.vehicleRegistration} (${Math.abs(mileageUntilRotation)}km de retard)`,
          vehicle,
          priority: 'high'
        });
      } else if (mileageUntilRotation <= 5000) {
        actions.rotationApproaching.push({
          type: 'rotation_approaching',
          message: `Rotation en approche : ${vehicle.vehicleRegistration} (dans ${mileageUntilRotation}km)`,
          vehicle,
          priority: 'medium'
        });
      }
    }

    return actions;
  }

  // Cette méthode a été déplacée plus haut dans le fichier

  /** Rotation `rotationId` avec le mouvement de chaque pneu (`null` si inconnue). */
  async getTireRotationDetails(rotationId: number): Promise<any | null> {
    try {
      const [rotation] = await db
        .select({
          id: tireRotations.id,
          vehicleId: tireRotations.vehicleId,
          rotationDate: tireRotations.rotationDate,
          rotationMileage: tireRotations.rotationMileage,
          rotationType: tireRotations.rotationType,
          performedBy: tireRotations.performedBy,
          cost: tireRotations.cost,
          nextRotationMileage: tireRotations.nextRotationMileage,
          notes: tireRotations.notes,
          createdAt: tireRotations.createdAt,
          vehicleRegistration: vehicles.registrationNumber,
        })
        .from(tireRotations)
        .leftJoin(vehicles, eq(tireRotations.vehicleId, vehicles.id))
        .where(eq(tireRotations.id, rotationId));
      if (!rotation) return null;
      const movements = await db
        .select({
          id: tireRotationDetails.id,
          vehicleTireId: tireRotationDetails.vehicleTireId,
          fromPosition: tireRotationDetails.fromPosition,
          toPosition: tireRotationDetails.toPosition,
        })
        .from(tireRotationDetails)
        .where(eq(tireRotationDetails.rotationId, rotationId))
        .orderBy(tireRotationDetails.id);
      return { ...rotation, movements };
    } catch (error) {
      log.error({ err: error, rotationId }, "lecture du détail de rotation en échec");
      throw new Error("Erreur lors de la lecture de la rotation");
    }
  }

  async getTireStatistics(): Promise<any> {
    try {
      // Calculer la quantité totale en stock (SOMME des stockQuantity)
      const [stockResult] = await db
        .select({ 
          totalStock: sql<number>`COALESCE(SUM(${tires.stockQuantity}), 0)`,
          usedQuantity: sql<number>`COALESCE(SUM(${tires.usedStockQuantity}), 0)`,
        })
        .from(tires)
        .where(isNull(tires.deletedAt));

      // Calculer la valeur totale d'inventaire (SOMME de stockQuantity × purchasePrice)
      const [valueResult] = await db
        .select({ 
          totalValue: sql<number>`COALESCE(SUM(${tires.stockQuantity} * ${tires.purchasePrice}), 0)` 
        })
        .from(tires)
        .where(isNull(tires.deletedAt));

      // Compter les pneus montés sur véhicules (20 pneus = quantité montée)
      const [installationsResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(vehicleTires)
        .where(eq(vehicleTires.status, 'active'));

      // Compter les references distinctes au catalogue (fiches, pas quantites)
      const [referencesResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(tires)
        .where(isNull(tires.deletedAt));

      // Compter les actions requises (stocks faibles)
      const [actionsResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(tires)
        .where(and(
          isNull(tires.deletedAt),
          sql`${tires.stockQuantity} <= ${tires.minStockLevel}`
        ));

      console.log('Tire statistics calculated:', {
        totalStock: stockResult?.totalStock,
        totalValue: valueResult?.totalValue,
        installations: installationsResult?.count,
        actions: actionsResult?.count
      });

      return {
        // `totalTires` vaut la SOMME des quantités, pas un nombre de fiches.
        // Nom historique et trompeur, conservé pour compatibilité: préférer
        // `totalStock` (unités) et `totalReferences` (fiches au catalogue).
        totalTires: stockResult?.totalStock?.toString() || "0",
        // Neuf seul : l'usagé n'est pas valorisé et ne déclenche pas le stock bas.
        totalStock: Number(stockResult?.totalStock || 0),
        usedQuantity: Number(stockResult?.usedQuantity || 0),
        totalReferences: Number(referencesResult?.count || 0),
        totalValue: Math.round(valueResult?.totalValue || 0),
        activeInstallations: installationsResult?.count || 0,
        lowStockCount: actionsResult?.count || 0,
        averageWear: "8.9mm", // TODO valeur codée en dur, à calculer depuis tireInspections
        requiredActions: actionsResult?.count || 0
      };
    } catch (error) {
      console.error('Error calculating tire statistics:', error);
      return {
        totalTires: "0",
        totalStock: 0,
        usedQuantity: 0,
        totalValue: 0,
        activeInstallations: 0,
        lowStockCount: 0,
        averageWear: "0mm",
        requiredActions: 0
      };
    }
  }

  async getLowStockTires(): Promise<Tire[]> {
    try {
      const result = await db
        .select()
        .from(tires)
        .where(and(
          isNull(tires.deletedAt),
          sql`${tires.stockQuantity} <= ${tires.minStockLevel}`
        ))
        .orderBy(desc(tires.createdAt));
      
      return result;
    } catch (error) {
      console.error('Error getting low stock tires:', error);
      return [];
    }
  }

  async getTireAlerts(): Promise<any[]> {
    return [];
  }
}

export const tiresService = new TiresService();
