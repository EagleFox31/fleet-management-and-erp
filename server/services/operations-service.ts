import { publicClientColumns } from "../lib/client-public-columns";
import { db } from "../db";
import {
  missions,
  clients,
  assignments,
  vehicles,
  fuelRecords,
  drivers,
  type Mission,
  type Client,
} from "@shared/schema";
import { eq, asc, desc, and, sql, gte, lte, isNull, inArray } from "drizzle-orm";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { canReadPurchasePrice, type PriceReader } from "../lib/vehicle-price-scope";
import { driverLiveAssignmentFilter, missionsOfDriversFilter, pickMissionAssignment } from "../lib/driver-scope";

const log = moduleLogger("operations-service");

/**
 * Service Opérations & Missions
 * 
 * Responsabilités:
 * - Gestion des missions de transport
 * - Création missions depuis données carburant réelles (24 enregistrements août 2025)
 * - Calcul des coûts opérationnels
 * - Statistiques par client (MAERSK, CNPCC, AGL, SODECOTON)
 * - Statistiques par destination (NDJAMENA, DLA-NDERE, TOUBORO)
 */
/** Missions où l'un de ces chauffeurs a une affectation vivante (cloison chauffeur, server/lib/driver-scope.ts). */
const missionsOfDrivers = missionsOfDriversFilter;

type AssignmentKey = { id: number; driverId: number | null; status: string };

/**
 * Une mission peut avoir plusieurs affectations (un chauffeur chacune) : la jointure `assignments` rend
 * alors une ligne par affectation. Garde une seule ligne par mission, celle de l'affectation que
 * `pickMissionAssignment` présente aussi dans `GET /api/missions/:id` (la plus ancienne active, puis la
 * plus ancienne non annulée ni refusée), pour qu'une mission ne soit ni listée ni comptée deux fois et
 * qu'elle affiche le même chauffeur et le même véhicule partout. L'ordre des missions est conservé.
 */
function onePerMission<T>(
  rows: T[],
  missionIdOf: (row: T) => number,
  assignmentOf: (row: T) => AssignmentKey | null,
): T[] {
  const byMission = new Map<number, T[]>();
  for (const row of rows) {
    const group = byMission.get(missionIdOf(row));
    if (group) group.push(row);
    else byMission.set(missionIdOf(row), [row]);
  }
  return Array.from(byMission.values(), (group) => {
    const keyed = group.flatMap((row) => {
      const a = assignmentOf(row);
      return a ? [{ ...a, row }] : [];
    });
    return pickMissionAssignment(keyed)?.row ?? group[0];
  });
}

/** Clé d'affectation d'une ligne lue avec les colonnes `assignmentId`, `assignmentDriverId`, `assignmentStatus`. */
function flatAssignmentKey(row: { assignmentId: number | null; assignmentDriverId: number | null; assignmentStatus: string | null }): AssignmentKey | null {
  return row.assignmentId === null ? null : { id: row.assignmentId, driverId: row.assignmentDriverId, status: row.assignmentStatus ?? "" };
}

/** Retire les colonnes techniques de `flatAssignmentKey` : la forme de la réponse ne change pas. */
function withoutAssignmentKey<T extends { assignmentId: unknown; assignmentDriverId: unknown; assignmentStatus: unknown }>(
  row: T,
): Omit<T, "assignmentId" | "assignmentDriverId" | "assignmentStatus"> {
  const { assignmentId: _id, assignmentDriverId: _driver, assignmentStatus: _status, ...rest } = row;
  return rest;
}

const assignmentKeyColumns = {
  assignmentId: assignments.id,
  assignmentDriverId: assignments.driverId,
  assignmentStatus: assignments.status,
};

/**
 * Jointure des affectations : pour un chauffeur, ses seules affectations. Une mission réaffectée
 * porte aussi celle d'un autre chauffeur (nom, véhicule), qu'il n'a pas à lire.
 */
function assignmentsJoin(driverScope?: number[]) {
  const onMission = eq(missions.id, assignments.missionId);
  return driverScope ? and(onMission, driverLiveAssignmentFilter(driverScope))! : onMission;
}

export class OperationsService {
  
  /**
   * Créer une mission depuis un enregistrement carburant réel
   * Exploite les 24 enregistrements carburant août 2025
   */
  async createMissionFromFuel(fuelRecordId: number, additionalData: {
    clientName: string;
    orderNumber?: string;
    pickupAddress?: string;
    roadExpenses?: number;
    userId: number;
  }) {
    console.log(`Creating mission from fuel record ${fuelRecordId}...`);
    
    // Récupérer l'enregistrement carburant
    const [fuelRecord] = await db
      .select()
      .from(fuelRecords)
      .where(and(eq(fuelRecords.id, fuelRecordId), isNull(fuelRecords.deletedAt)))
      .limit(1);

    if (!fuelRecord) {
      throw new AppError(404, "Enregistrement carburant non trouvé.");
    }

    // Vérifier/créer le client
    let [client] = await db
      .select(publicClientColumns)
      .from(clients)
      .where(eq(clients.name, additionalData.clientName))
      .limit(1);

    if (!client) {
      // Créer le client s'il n'existe pas
      [client] = await db
        .insert(clients)
        .values({
          name: additionalData.clientName,
          isActive: true,
          createdBy: additionalData.userId,
        })
        .returning(publicClientColumns);
      
      console.log(`Client ${additionalData.clientName} créé automatiquement`);
    }

    // Générer numéro de commande automatique si non fourni
    const orderNumber = additionalData.orderNumber || `ORD-${Date.now()}`;

    // Créer la mission
    const [mission] = await db
      .insert(missions)
      .values({
        clientId: client.id,
        orderNumber: orderNumber,
        missionType: "delivery",
        pickupAddress: additionalData.pickupAddress || "DOUALA",
        deliveryAddress: fuelRecord.destination || "N/A",
        deliveryDate: fuelRecord.date ? new Date(fuelRecord.date) : undefined,
        actualDistance: undefined,
        actualFuelCost: fuelRecord.debitAmount ? fuelRecord.debitAmount : undefined,
        actualFuelQuantity: fuelRecord.quantity || undefined,
        status: "completed", // Mission déjà effectuée
        createdBy: additionalData.userId,
      })
      .returning();

    // Créer l'assignment si un véhicule est lié
    if (fuelRecord.vehicleId) {
      await db
        .insert(assignments)
        .values({
          missionId: mission.id,
          vehicleId: fuelRecord.vehicleId,
          status: "completed",
          startedAt: fuelRecord.date ? new Date(fuelRecord.date) : undefined,
          completedAt: fuelRecord.date ? new Date(fuelRecord.date) : undefined,
        });
      
      console.log(`Assignment créé: véhicule ${fuelRecord.vehicleId} → mission ${mission.id}`);
    }

    console.log(`Mission ${mission.id} créée depuis fuel record ${fuelRecordId}`);
    
    return {
      mission,
      client,
      fuelRecord,
    };
  }

  /**
   * Récupérer missions par client
   * Clients réels: MAERSK, CNPCC, AGL, SODECOTON
   */
  async getMissionsByClient(clientName: string, filters?: {
    startDate?: Date;
    endDate?: Date;
    status?: string;
  }) {
    console.log(`Fetching missions for client: ${clientName}`);

    // Récupérer le client
    const [client] = await db
      .select(publicClientColumns)
      .from(clients)
      .where(eq(clients.name, clientName))
      .limit(1);

    if (!client) {
      return {
        missions: [],
        statistics: {
          totalMissions: 0,
          totalFuelConsumed: 0,
          totalFuelCost: 0,
          totalRevenue: 0,
          margin: 0,
          marginPercentage: 0,
        }
      };
    }

    // Construire les conditions de filtrage
    const conditions = [eq(missions.clientId, client.id)];

    if (filters?.startDate && filters?.endDate) {
      conditions.push(
        gte(missions.deliveryDate, filters.startDate),
        lte(missions.deliveryDate, filters.endDate)
      );
    }

    if (filters?.status) {
      conditions.push(sql`${missions.status} = ${filters.status}`);
    }

    // Construire la requête avec filtres
    const query = db
      .select({
        mission: missions,
        vehicle: vehicles,
        assignment: assignments,
      })
      .from(missions)
      .leftJoin(assignments, eq(missions.id, assignments.missionId))
      .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id))
      .where(and(...conditions));

    const results = onePerMission(await query.orderBy(asc(assignments.id)), (r) => r.mission.id, (r) => r.assignment);
    const missionsList = results.map(r => ({
      ...r.mission,
      vehicle: r.vehicle,
      assignment: r.assignment,
    }));

    // Calculer statistiques
    const totalFuel = missionsList.reduce((sum, m) => sum + (m.actualFuelQuantity || 0), 0);
    const totalFuelCost = missionsList.reduce((sum, m) => sum + (parseFloat(String(m.actualFuelCost || 0))), 0);
    const totalRevenue = missionsList.reduce((sum, m) => sum + (parseFloat(String(m.estimatedFuelCost || 0))), 0);
    const margin = totalRevenue - totalFuelCost;
    const marginPercentage = totalRevenue > 0 ? (margin / totalRevenue * 100) : 0;

    console.log(`Found ${missionsList.length} missions for ${clientName}`);

    return {
      missions: missionsList,
      statistics: {
        totalMissions: missionsList.length,
        totalFuelConsumed: totalFuel,
        totalFuelCost,
        totalRevenue,
        margin,
        marginPercentage,
      }
    };
  }

  /**
   * Statistiques par destination
   * Destinations réelles: NDJAMENA, DLA-NDERE, TOUBORO
   */
  async getStatsByDestination() {
    console.log("Calculating stats by destination...");

    const allMissions = await db
      .select()
      .from(missions)
      .where(inArray(missions.status, ["in_progress", "delivered", "completed"]));

    const byDestination = allMissions.reduce((acc, mission) => {
      const dest = mission.deliveryAddress || "AUTRE";
      if (!acc[dest]) {
        acc[dest] = {
          destination: dest,
          count: 0,
          totalFuel: 0,
          totalFuelCost: 0,
          totalRevenue: 0,
        };
      }
      acc[dest].count++;
      acc[dest].totalFuel += mission.actualFuelQuantity || 0;
      acc[dest].totalFuelCost += parseFloat(String(mission.actualFuelCost || 0));
      acc[dest].totalRevenue += parseFloat(String(mission.estimatedFuelCost || 0));
      return acc;
    }, {} as Record<string, any>);

    const results = Object.values(byDestination);
    console.log(`Stats calculated for ${results.length} destinations`);

    return results;
  }

  /**
   * Statistiques globales par client
   */
  async getStatsByClient() {
    console.log("Calculating global stats by client...");

    const results = await db
      .select({
        client: publicClientColumns,
        missions: sql<number>`COUNT(${missions.id})`,
        totalFuel: sql<string>`COALESCE(SUM(${missions.actualFuelQuantity}), 0)`,
        totalFuelCost: sql<string>`COALESCE(SUM(${missions.actualFuelCost}), 0)`,
        totalRevenue: sql<string>`COALESCE(SUM(${missions.estimatedFuelCost}), 0)`,
      })
      .from(clients)
      .leftJoin(missions, eq(clients.id, missions.clientId))
      .groupBy(clients.id);

    const stats = results.map(r => {
      const fuelCost = parseFloat(r.totalFuelCost || "0");
      const revenue = parseFloat(r.totalRevenue || "0");
      const margin = revenue - fuelCost;

      return {
        clientName: r.client.name,
        clientId: r.client.id,
        totalMissions: Number(r.missions),
        totalFuelConsumed: parseFloat(r.totalFuel || "0"),
        totalFuelCost: fuelCost,
        totalRevenue: revenue,
        margin,
        marginPercentage: revenue > 0 ? (margin / revenue * 100) : 0,
      };
    });

    console.log(`Stats calculated for ${stats.length} clients`);
    return stats;
  }

  /**
   * Récupérer toutes les missions avec détails complets
   */
  async getAllMissions(filters?: {
    status?: string;
    clientId?: number;
    startDate?: Date;
    endDate?: Date;
  }, driverScope?: number[]) {
    console.log("Fetching all missions with filters:", filters);

    const conditions: any[] = [];

    if (driverScope) conditions.push(missionsOfDrivers(driverScope));

    if (filters?.status) {
      conditions.push(sql`${missions.status} = ${filters.status}`);
    }

    if (filters?.clientId) {
      conditions.push(eq(missions.clientId, filters.clientId));
    }

    if (filters?.startDate && filters?.endDate) {
      conditions.push(
        gte(missions.deliveryDate, filters.startDate),
        lte(missions.deliveryDate, filters.endDate)
      );
    }

    let query = db
      .select({
        mission: missions,
        client: publicClientColumns,
        vehicle: vehicles,
        assignment: assignments,
      })
      .from(missions)
      .leftJoin(clients, eq(missions.clientId, clients.id))
      .leftJoin(assignments, assignmentsJoin(driverScope))
      .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const results = onePerMission(
      await query.orderBy(desc(missions.createdAt), asc(assignments.id)),
      (r) => r.mission.id,
      (r) => r.assignment,
    );

    const missionsList = results.map(r => ({
      ...r.mission,
      client: r.client,
      // Prix d'achat expurgé par les routes (redactVehiclePriceDeep), selon le rôle du lecteur.
      vehicle: r.vehicle,
      assignment: r.assignment,
    }));

    console.log(`Fetched ${missionsList.length} missions`);
    return missionsList;
  }

  /**
   * Missions à venir : planned + assigned (pas encore démarrées)
   */
  async getUpcomingMissions(driverScope?: number[]) {
    const results = await db
      .select({
        id: missions.id,
        orderNumber: missions.orderNumber,
        status: missions.status,
        pickupAddress: missions.pickupAddress,
        pickupDate: missions.pickupDate,
        deliveryAddress: missions.deliveryAddress,
        deliveryDate: missions.deliveryDate,
        clientName: clients.name,
        vehicleRegistration: vehicles.registrationNumber,
        driverName: drivers.firstName,
        ...assignmentKeyColumns,
      })
      .from(missions)
      .leftJoin(clients, eq(missions.clientId, clients.id))
      .leftJoin(assignments, assignmentsJoin(driverScope))
      .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id))
      .leftJoin(drivers, eq(assignments.driverId, drivers.id))
      .where(
        driverScope
          ? and(inArray(missions.status, ["planned", "assigned"]), missionsOfDrivers(driverScope))
          : inArray(missions.status, ["planned", "assigned"]),
      )
      .orderBy(missions.pickupDate, asc(assignments.id));

    return onePerMission(results, (r) => r.id, flatAssignmentKey).map(withoutAssignmentKey);
  }

  /**
   * Missions actives : in_progress
   */
  async getActiveMissions(driverScope?: number[]) {
    const results = await db
      .select({
        id: missions.id,
        orderNumber: missions.orderNumber,
        status: missions.status,
        pickupAddress: missions.pickupAddress,
        pickupDate: missions.pickupDate,
        deliveryAddress: missions.deliveryAddress,
        deliveryDate: missions.deliveryDate,
        clientName: clients.name,
        vehicleRegistration: vehicles.registrationNumber,
        driverName: drivers.firstName,
        startedAt: assignments.startedAt,
        ...assignmentKeyColumns,
      })
      .from(missions)
      .leftJoin(clients, eq(missions.clientId, clients.id))
      .leftJoin(assignments, assignmentsJoin(driverScope))
      .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id))
      .leftJoin(drivers, eq(assignments.driverId, drivers.id))
      .where(
        driverScope
          ? and(eq(missions.status, "in_progress"), missionsOfDrivers(driverScope))
          : eq(missions.status, "in_progress"),
      )
      .orderBy(missions.deliveryDate, asc(assignments.id));

    return onePerMission(results, (r) => r.id, flatAssignmentKey).map(withoutAssignmentKey);
  }

  /**
   * Calculer les coûts d'une mission
   */
  async calculateMissionCosts(missionId: number, reader?: PriceReader) {
    log.debug({ missionId }, "Calcul des coûts de mission");

    const [mission] = await db
      .select()
      .from(missions)
      .where(eq(missions.id, missionId))
      .limit(1);

    if (!mission) {
      throw new AppError(404, "Mission non trouvée.");
    }

    const fuelCost = parseFloat(String(mission.actualFuelCost || 0));
    
    // Coût véhicule (amortissement si disponible)
    let vehicleCost = 0;
    const [assignment] = await db
      .select({
        assignment: assignments,
        purchasePrice: vehicles.purchasePrice,
      })
      .from(assignments)
      .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id))
      .where(eq(assignments.missionId, missionId))
      .limit(1);

    if (assignment?.purchasePrice) {
      // Amortissement simple: prix achat / 1000 jours * 1 jour
      vehicleCost = parseFloat(String(assignment.purchasePrice)) / 1000;
    }

    // Le coût véhicule est le prix d'achat divisé par 1000 : le renvoyer à un lecteur
    // non autorisé le lui livrerait. Pour lui, le terme est absent (null) et le total
    // ne le compte pas.
    if (!canReadPurchasePrice(reader)) {
      return {
        fuelCost,
        vehicleCost: null,
        totalCost: fuelCost,
        breakdown: {
          fuel: fuelCost,
          vehicle: null,
        },
      };
    }

    const totalCost = fuelCost + vehicleCost;

    return {
      fuelCost,
      vehicleCost,
      totalCost,
      breakdown: {
        fuel: fuelCost,
        vehicle: vehicleCost,
      }
    };
  }
}

export const operationsService = new OperationsService();
