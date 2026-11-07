import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Profil technicien : un coût d'OT qu'on n'a pas pu calculer n'est pas un coût nul.
 *
 * Avant ce correctif, `calculateWorkOrderCosts` journalisait l'échec d'une des requêtes de coût
 * et renvoyait une carte vide ; `getTechnicianWorkOrders` lisait alors `ZERO_COST` pour chaque OT,
 * y compris ceux dont `work_orders.cost` était renseigné. La route répondait 200 et le profil
 * affichait « 0 » comme une vraie valeur.
 */
const dbFailure = new Error("timeout exceeded when trying to connect");

/** Chaîne Drizzle factice : toute méthode renvoie la chaîne, l'attente résout ou rejette. */
function query(outcome: { rows: unknown[] } | { error: unknown }): unknown {
  const chain: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            "error" in outcome ? reject(outcome.error) : resolve(outcome.rows);
        }
        return () => chain;
      },
    },
  );
  return chain;
}

const workOrderRow = {
  id: 1,
  vehicleId: 7,
  title: "Vidange",
  description: null,
  priority: "medium",
  status: "completed",
  startDate: null,
  endDate: null,
  duration: null,
  cost: "500",
  technicianId: 3,
  createdAt: new Date("2026-11-01T08:00:00Z"),
  updatedAt: null,
  vehicleRegistrationNumber: "LT-123-AB",
  vehicleBrand: "Volvo",
  vehicleModel: "FH",
  vehicleMileage: 1000,
  vehicleCurrentKilometers: 1000,
  assignedTechnicianName: "Tech",
};

const select = vi.fn();
vi.mock("../../../server/db", () => ({ db: { select: (...args: unknown[]) => select(...args) } }));
vi.mock("../../../server/services/workshop-labor-rates-service", () => ({
  laborRatesForWorkOrders: async () => new Map(),
}));

import { technicianWorkOrdersService } from "../../../server/services/technician-work-orders-service";
import { AppError } from "../../../server/lib/app-error";

describe("OT du technicien : échec du calcul de coût", () => {
  beforeEach(() => {
    select.mockReset();
    // 1re requête : la liste des OT ; les suivantes : heures, pièces, rotations de pneus.
    select.mockImplementationOnce(() => query({ rows: [workOrderRow] }));
    select.mockImplementation(() => query({ error: dbFailure }));
  });

  it("lève une AppError 5xx au lieu de renvoyer des OT à coût 0", async () => {
    const outcome = await technicianWorkOrdersService.getTechnicianWorkOrders(3).then(
      (value: unknown) => ({ value }),
      (error: unknown) => ({ error }),
    );

    expect(outcome).not.toHaveProperty("value");
    const { error } = outcome as { error: unknown };
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBeGreaterThanOrEqual(500);
    expect((error as AppError).cause).toBe(dbFailure);
  });

  it("le message destiné à l'utilisateur ne contient aucun détail technique", async () => {
    const error = await technicianWorkOrdersService.getTechnicianWorkOrders(3).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).not.toMatch(/timeout|connect|sql|select/i);
  });

  it("les statistiques propagent l'erreur au lieu de compter sur des coûts faux", async () => {
    await expect(technicianWorkOrdersService.getTechnicianWorkOrderStats(3)).rejects.toBeInstanceOf(AppError);
  });

  it("calcul réussi : le coût de base est conservé", async () => {
    select.mockReset();
    select.mockImplementationOnce(() => query({ rows: [workOrderRow] }));
    select.mockImplementation(() => query({ rows: [] }));

    const [wo] = await technicianWorkOrdersService.getTechnicianWorkOrders(3);
    expect(wo.cost).toBe(500);
    expect(wo.baseCost).toBe(500);
    expect(wo.partsCost).toBe(0);
    expect(wo.tiresCost).toBe(0);
  });
});

describe("OT en attente du technicien : erreur de base", () => {
  it("lève une AppError au lieu de compter 0", async () => {
    select.mockReset();
    select.mockImplementation(() => query({ error: dbFailure }));

    const error = await technicianWorkOrdersService.getPendingWorkOrdersCount(3).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).cause).toBe(dbFailure);
  });
});
