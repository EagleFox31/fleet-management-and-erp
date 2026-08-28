import { describe, it, expect } from "vitest";
import { Alert } from "@/services/alertsService";
import { warehouseService } from "@/services/warehouseService";
import { fuelCardService } from "@/services/fuelCardService";
import { billingService } from "@/services/billingService";
import { vehiclesService } from "@/services/vehiclesService";
import { maintenanceService } from "@/services/maintenanceService";
import { alertsService } from "@/services/alertsService";
import { reportsService } from "@/services/reportsService";

describe("Services Frontend", () => {
  describe("warehouseService", () => {
    it("exporte les méthodes attendues", () => {
      expect(warehouseService.getInventoryValue).toBeTypeOf("function");
      expect(warehouseService.formatCurrency).toBeTypeOf("function");
      expect(warehouseService.calculateStockHealth).toBeTypeOf("function");
    });

    it("formatCurrency formate les montants", () => {
      const formatted = warehouseService.formatCurrency(94400000);
      expect(formatted).toContain("94");
      expect(formatted).toContain("400");
      expect(formatted).toContain("000");
    });

    it("calculateStockHealth retourne le statut", () => {
      expect(warehouseService.calculateStockHealth(0, 10)).toBe("critical");
      expect(warehouseService.calculateStockHealth(5, 10)).toBe("warning");
      expect(warehouseService.calculateStockHealth(20, 10)).toBe("healthy");
    });
  });

  describe("fuelCardService", () => {
    it("formatLiters formate les litres", () => {
      expect(fuelCardService.formatLiters(123.456)).toBe("123.46 L");
    });

    it("calculateConsumptionRate calcule L/100 km", () => {
      expect(fuelCardService.calculateConsumptionRate(50, 1000)).toBe(5);
    });
  });

  describe("billingService", () => {
    it("calcule la TVA 19.25%", () => {
      expect(billingService.calculateVATAmount(100000, 19.25)).toBe(19250);
      expect(billingService.calculateTotalWithVAT(100000, 19.25)).toBe(119250);
    });
  });

  describe("vehiclesService", () => {
    it("libellés de statut véhicule", () => {
      expect(vehiclesService.getStatusLabel("operational")).toBe("Opérationnel");
      expect(vehiclesService.getStatusLabel("maintenance")).toBe("En maintenance");
      expect(vehiclesService.getStatusLabel("out_of_service")).toBe("Hors service");
    });

    it("formatMileage inclut km", () => {
      const formatted = vehiclesService.formatMileage(150000);
      expect(formatted).toContain("150");
      expect(formatted).toContain("000");
      expect(formatted).toContain("km");
    });
  });

  describe("maintenanceService", () => {
    it("libellés OT et priorité", () => {
      expect(maintenanceService.getStatusLabel("pending")).toBe("En attente");
      expect(maintenanceService.getStatusLabel("in_progress")).toBe("En cours");
      expect(maintenanceService.getStatusLabel("completed")).toBe("Terminé");
      expect(maintenanceService.getPriorityLabel("low")).toBe("Basse");
      expect(maintenanceService.getPriorityLabel("urgent")).toBe("Urgente");
    });
  });

  describe("alertsService", () => {
    it("sortByPriority met critical en premier", () => {
      const alerts: Alert[] = [
        { id: 1, type: "maintenance", severity: "info", title: "Info Alert", message: "Info message", isRead: false, createdAt: "2025-01-01" },
        { id: 2, type: "fuel", severity: "critical", title: "Critical Alert", message: "Critical message", isRead: false, createdAt: "2025-01-02" },
        { id: 3, type: "document", severity: "warning", title: "Warning Alert", message: "Warning message", isRead: false, createdAt: "2025-01-03" },
      ];
      const sorted = alertsService.sortByPriority(alerts);
      expect(sorted[0].severity).toBe("critical");
      expect(sorted[1].severity).toBe("warning");
      expect(sorted[2].severity).toBe("info");
    });
  });

  describe("reportsService", () => {
    it("formatPercentage", () => {
      expect(reportsService.formatPercentage(75.5678)).toBe("75.6%");
    });

    it("generateDashboardKPIs compte les OT pending", async () => {
      const kpis = await reportsService.generateDashboardKPIs(
        94400000,
        14100000,
        38,
        { totalVehicles: 50, operational: 40, maintenance: 8 },
        [{ status: "pending" }, { status: "pending" }, { status: "completed" }],
      );

      expect(kpis.inventoryValue).toBe(94400000);
      expect(kpis.pendingWorkOrders).toBe(2);
    });
  });
});
