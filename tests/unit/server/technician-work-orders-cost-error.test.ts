import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Profil technicien : un coût d'OT qu'on n'a pas pu calculer n'est pas un coût nul.
 *
 * Avant ce correctif, `calculateWorkOrderCosts` journalisait l'échec d'une des requêtes de coût
 * et renvoyait une carte vide ; `getTechnicianWorkOrders` lisait alors `ZERO_COST` pour chaque OT,
 * y compris ceux dont `work_orders.cost` était renseigné. La route répondait 200 et le profil
 * affichait « 0 » comme une vraie valeur.
 *
 * Contrat retenu (décision 0a) : la liste reste servie, car un technicien qui ne voit plus ses
 * interventions ne peut plus travailler ; l'OT sans coût porte `cost: null` et
 * `costUnavailable: true`.
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
const laborRates = vi.fn(async (): Promise<Map<number, number | null>> => new Map());
vi.mock("../../../server/services/workshop-labor-rates-service", () => ({
  laborRatesForWorkOrders: () => laborRates(),
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

  it("la liste reste servie : le technicien voit toujours ses interventions", async () => {
    const list = await technicianWorkOrdersService.getTechnicianWorkOrders(3);
    expect(list.map((wo) => wo.id)).toEqual([1]);
    expect(list[0].title).toBe("Vidange");
  });

  it("l'OT dont le coût n'a pas pu être calculé porte des coûts null, jamais 0", async () => {
    const [wo] = await technicianWorkOrdersService.getTechnicianWorkOrders(3);
    expect(wo.costUnavailable).toBe(true);
    expect(wo.cost).toBeNull();
    // Sans taux, la main-d'oeuvre vaut work_orders.cost : elle reste connue.
    expect(wo.baseCost).toBe(500);
    expect(wo.partsCost).toBeNull();
    expect(wo.tiresCost).toBeNull();
  });

  it("les statistiques (comptages) restent calculées", async () => {
    const stats = await technicianWorkOrdersService.getTechnicianWorkOrderStats(3);
    expect(stats.completed).toBe(1);
    expect(stats.total).toBe(1);
  });

  it("calcul réussi : le coût de base est conservé", async () => {
    select.mockReset();
    select.mockImplementationOnce(() => query({ rows: [workOrderRow] }));
    select.mockImplementation(() => query({ rows: [] }));

    const [wo] = await technicianWorkOrdersService.getTechnicianWorkOrders(3);
    expect(wo.costUnavailable).toBe(false);
    expect(wo.cost).toBe(500);
    expect(wo.baseCost).toBe(500);
    expect(wo.partsCost).toBe(0);
    expect(wo.tiresCost).toBe(0);
  });
});

describe("OT du technicien : seule la composante en échec passe à null", () => {
  // Ordre des requêtes de coût : liste, heures, pièces, rotations (taux mockés à vide).
  function failOnly(index: number) {
    select.mockReset();
    select.mockImplementationOnce(() => query({ rows: [workOrderRow] }));
    for (let i = 1; i <= 3; i++) {
      select.mockImplementationOnce(() => (i === index ? query({ error: dbFailure }) : query({ rows: [] })));
    }
  }

  it("rotations en échec : pneus et total à null, main-d'oeuvre et pièces conservées", async () => {
    failOnly(3);
    const [wo] = await technicianWorkOrdersService.getTechnicianWorkOrders(3);
    expect(wo.tiresCost).toBeNull();
    expect(wo.cost).toBeNull();
    expect(wo.costUnavailable).toBe(true);
    expect(wo.baseCost).toBe(500);
    expect(wo.partsCost).toBe(0);
  });

  it("pièces en échec : pièces et total à null", async () => {
    failOnly(2);
    const [wo] = await technicianWorkOrdersService.getTechnicianWorkOrders(3);
    expect(wo.partsCost).toBeNull();
    expect(wo.cost).toBeNull();
    expect(wo.tiresCost).toBe(0);
  });

  it("taux en échec : main-d'oeuvre et total à null", async () => {
    failOnly(0);
    laborRates.mockRejectedValueOnce(dbFailure);
    const [wo] = await technicianWorkOrdersService.getTechnicianWorkOrders(3);
    expect(wo.baseCost).toBeNull();
    expect(wo.cost).toBeNull();
    expect(wo.partsCost).toBe(0);
  });

  it("heures en échec sans taux : la main-d'oeuvre vaut work_orders.cost, le total reste connu", async () => {
    failOnly(1);
    const [wo] = await technicianWorkOrdersService.getTechnicianWorkOrders(3);
    expect(wo.baseCost).toBe(500);
    expect(wo.cost).toBe(500);
    expect(wo.costUnavailable).toBe(false);
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
