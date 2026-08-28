import { db } from "../db";
import { parts, partsStockMovements, users, workOrders } from "@shared/schema";
import { desc, gte, lte, and, eq } from "drizzle-orm";

export class ReportsService {
  private toNumber(value: string | number | null | undefined): number {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }

    const parsed = Number.parseFloat(String(value ?? "0"));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // Récupérer toutes les données nécessaires pour le rapport d'inventaire des pièces
  async getInventoryReportData(startDate: Date, endDate: Date) {
    try {
      console.log('Generating inventory report data for period:', startDate, 'to', endDate);

      // Récupérer toutes les pièces
      const allParts = await db.select().from(parts);
      console.log(`Found ${allParts.length} parts in inventory`);

      // Récupérer tous les mouvements de stock pour la période
      const allMovements = await db
        .select({
          id: partsStockMovements.id,
          partId: partsStockMovements.partId,
          movementType: partsStockMovements.movementType,
          quantity: partsStockMovements.quantity,
          previousStock: partsStockMovements.previousStock,
          newStock: partsStockMovements.newStock,
          reason: partsStockMovements.reason,
          notes: partsStockMovements.notes,
          workOrderId: partsStockMovements.workOrderId,
          createdAt: partsStockMovements.createdAt,
          createdByName: users.name
        })
        .from(partsStockMovements)
        .leftJoin(users, eq(partsStockMovements.createdBy, users.id))
        .where(
          and(
            gte(partsStockMovements.createdAt, startDate),
            lte(partsStockMovements.createdAt, endDate)
          )
        )
        .orderBy(desc(partsStockMovements.createdAt));

      console.log(`Found ${allMovements.length} stock movements in period`);

      // Calculer les statistiques
      const totalValue = allParts.reduce((sum, part) => {
        const quantity = part.quantity ?? 0;
        const unitPrice = this.toNumber(part.unitPrice);
        return sum + (quantity * unitPrice);
      }, 0);
      const lowStockParts = allParts.filter(part => (part.quantity || 0) <= (part.minQuantity || 0));

      // Enrichir les données des pièces avec les mouvements de la période
      const enrichedParts = allParts.map(part => {
        const partMovements = allMovements.filter(movement => movement.partId === part.id);
        const totalMovements = partMovements.reduce((sum, movement) => sum + Math.abs(movement.quantity || 0), 0);
        
        return {
          ...part,
          movementsCount: totalMovements,
          movements: partMovements
        };
      });

      return {
        parts: enrichedParts,
        movements: allMovements,
        statistics: {
          totalParts: allParts.length,
          totalValue,
          lowStockCount: lowStockParts.length,
          totalMovements: allMovements.length
        }
      };
    } catch (error) {
      console.error('Error generating inventory report data:', error);
      throw error;
    }
  }

  // Nouveau service pour les rapports de performance des techniciens
  async getTechnicianPerformanceReportData(startDate: Date, endDate: Date) {
    try {
      console.log('Generating technician performance report for period:', startDate, 'to', endDate);
      
      // Récupérer tous les techniciens
      const allTechnicians = await db
        .select({
          id: users.id,
          name: users.name,
          username: users.username,
          email: users.email,
          role: users.role
        })
        .from(users)
        .where(eq(users.role, 'technician'));

      console.log(`Found ${allTechnicians.length} technicians`);

      // Récupérer tous les ordres de travail pour la période
      const allWorkOrders = await db
        .select()
        .from(workOrders)
        .where(
          and(
            gte(workOrders.createdAt, startDate),
            lte(workOrders.createdAt, endDate)
          )
        );

      console.log(`Found ${allWorkOrders.length} work orders in period`);

      // Calculer les performances par technicien
      const technicianPerformances = allTechnicians.map(technician => {
        const technicianWorkOrders = allWorkOrders.filter(wo => wo.technicianId === technician.id);
        const completedWorkOrders = technicianWorkOrders.filter(wo => wo.status === 'completed');
        const inProgressWorkOrders = technicianWorkOrders.filter(wo => wo.status === 'in_progress');
        
        const completionRate = technicianWorkOrders.length > 0 
          ? Math.round((completedWorkOrders.length / technicianWorkOrders.length) * 100)
          : 0;

        return {
          id: technician.id,
          name: technician.name,
          username: technician.username,
          email: technician.email,
          role: technician.role,
          totalWorkOrders: technicianWorkOrders.length,
          completedWorkOrders: completedWorkOrders.length,
          inProgressWorkOrders: inProgressWorkOrders.length,
          completionRate,
          workOrders: technicianWorkOrders
        };
      });

      // Statistiques globales
      const totalActiveTechnicians = allTechnicians.length;
      const totalWorkOrders = allWorkOrders.length;
      const totalCompletedWorkOrders = allWorkOrders.filter(wo => wo.status === 'completed').length;

      const reportData = {
        technicians: technicianPerformances,
        workOrders: allWorkOrders,
        statistics: {
          totalActiveTechnicians,
          totalWorkOrders,
          totalCompletedWorkOrders,
          globalCompletionRate: totalWorkOrders > 0 
            ? Math.round((totalCompletedWorkOrders / totalWorkOrders) * 100)
            : 0
        }
      };

      console.log('Technician performance report data:', {
        techniciansCount: technicianPerformances.length,
        totalWorkOrders,
        totalCompleted: totalCompletedWorkOrders
      });

      return reportData;
    } catch (error) {
      console.error('Erreur lors de la génération du rapport de performance des techniciens:', error);
      throw error;
    }
  }

  // Récupérer les données pour le rapport de consommation de carburant
  async getFuelConsumptionReportData(startDate: Date, endDate: Date) {
    try {
      console.log('Generating fuel consumption report data for period:', startDate, 'to', endDate);
      
      // Cette méthode peut être implémentée plus tard si nécessaire
      // Pour l'instant, retourner des données vides
      return {
        vehicles: [],
        fuelRecords: [],
        statistics: {
          totalVehicles: 0,
          totalFuel: 0,
          totalCost: 0,
          totalRecords: 0
        }
      };
    } catch (error) {
      console.error('Error generating fuel consumption report data:', error);
      throw error;
    }
  }
}

export const reportsService = new ReportsService();
