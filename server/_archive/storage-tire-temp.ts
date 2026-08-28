// Méthodes temporaires simplifiées pour les pneus
import { db } from './db';
import { tires, vehicleTires, tireInspections, tireRotations } from '../shared/schema';

export const tempTireMethods = {
  async getTireStatistics() {
    try {
      console.log('getTireStatistics called - using temp methods');
      return {
        totalTires: 50,
        totalValue: 25000,
        lowStockCount: 5,
        totalMounted: 40,
        avgTreadDepth: 6.5,
        rotationsThisMonth: 8,
        costPerKm: 0.15,
        replacementsDue: 3
      };
    } catch (error) {
      console.error('Error in getTireStatistics:', error);
      return {
        totalTires: 0,
        totalValue: 0,
        lowStockCount: 0,
        totalMounted: 0,
        avgTreadDepth: 0,
        rotationsThisMonth: 0,
        costPerKm: 0,
        replacementsDue: 0
      };
    }
  },

  async getLowStockTires() {
    try {
      console.log('getLowStockTires called - using temp methods');
      return [
        {
          id: 1,
          brand: "Michelin",
          model: "Energy Saver",
          size: "205/55R16",
          stockQuantity: 2,
          minStockLevel: 5,
          location: "A1-B2",
          purchasePrice: 120.00
        },
        {
          id: 2,
          brand: "Continental",
          model: "EcoContact",
          size: "225/60R17",
          stockQuantity: 1,
          minStockLevel: 4,
          location: "B3-C1",
          purchasePrice: 140.00
        }
      ];
    } catch (error) {
      console.error('Error in getLowStockTires:', error);
      return [];
    }
  },

  async getVehicleTires() {
    try {
      console.log('getVehicleTires called - using temp methods');
      return [
        {
          id: 1,
          vehicleId: 1,
          vehicleRegistration: "AB-123-CD",
          tireId: 1,
          tireBrand: "Michelin",
          tireModel: "Energy Saver",
          tireSize: "205/55R16",
          position: "Avant Gauche",
          installationDate: "2024-01-15",
          currentTreadDepth: 7.2,
          status: "active"
        },
        {
          id: 2,
          vehicleId: 1,
          vehicleRegistration: "AB-123-CD",
          tireId: 2,
          tireBrand: "Michelin",
          tireModel: "Energy Saver",
          tireSize: "205/55R16",
          position: "Avant Droit",
          installationDate: "2024-01-15",
          currentTreadDepth: 7.0,
          status: "active"
        }
      ];
    } catch (error) {
      console.error('Error in getVehicleTires:', error);
      return [];
    }
  },

  async getTireInspections() {
    try {
      console.log('getTireInspections called - using temp methods');
      return [
        {
          id: 1,
          vehicleTireId: 1,
          vehicleRegistration: "AB-123-CD",
          tireBrand: "Michelin",
          position: "Avant Gauche",
          inspectionDate: "2024-05-20",
          treadDepth: 7.2,
          pressure: 2.3,
          wearPattern: "Uniforme",
          condition: "Bon",
          hasDefects: false,
          recommendedAction: "Continuer utilisation",
          nextInspectionDate: "2024-08-20"
        }
      ];
    } catch (error) {
      console.error('Error in getTireInspections:', error);
      return [];
    }
  }
};