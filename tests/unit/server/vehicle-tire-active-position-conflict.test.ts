import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Un pneu actif par position : l'index uq_vehicle_tires_active_position refuse le second de deux
 * montages concurrents (23505). Le service rend la même réponse que son contrôle applicatif
 * (POSITION_OCCUPIED, 409 par la route) et la modification d'un montage ne l'avale plus.
 */
const pgError = (code: string, constraint?: string) => Object.assign(new Error("duplicate key"), { code, constraint });
const conflict = pgError("23505", "uq_vehicle_tires_active_position");

let failure: unknown = conflict;

/** Chaîne Drizzle factice : toute méthode renvoie la chaîne, l'attente rejette avec `failure`. */
function failingQuery(): unknown {
  const chain: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return (_resolve: unknown, reject: (e: unknown) => void) => reject(failure);
        return () => chain;
      },
    },
  );
  return chain;
}

vi.mock("../../../server/db", () => ({
  db: {
    update: () => failingQuery(),
    transaction: () => Promise.reject(failure),
  },
}));

import { isActivePositionConflict, tiresService } from "../../../server/services/tires-service-simplified";
import { AppError } from "../../../server/lib/app-error";

const mount = {
  vehicleId: 7,
  tireId: 3,
  position: "front_left",
  installationDate: "2026-11-07",
  installationMileage: 1000,
} as Parameters<typeof tiresService.installTireOnVehicle>[0];

beforeEach(() => {
  failure = conflict;
});

describe("isActivePositionConflict", () => {
  it("reconnaît la violation de l'index, directe ou enveloppée par Drizzle", () => {
    expect(isActivePositionConflict(conflict)).toBe(true);
    expect(isActivePositionConflict(Object.assign(new Error("query failed"), { cause: conflict }))).toBe(true);
  });

  it("ignore une autre contrainte ou un autre code", () => {
    expect(isActivePositionConflict(pgError("23505", "vehicle_tires_pkey"))).toBe(false);
    expect(isActivePositionConflict(pgError("23503", "uq_vehicle_tires_active_position"))).toBe(false);
    expect(isActivePositionConflict(new Error("timeout"))).toBe(false);
  });
});

describe("montage concurrent refusé par l'index", () => {
  it("installTireOnVehicle rend POSITION_OCCUPIED, comme le contrôle applicatif", async () => {
    await expect(tiresService.installTireOnVehicle(mount)).rejects.toThrow("POSITION_OCCUPIED");
  });

  it("une autre erreur de base n'est pas maquillée en position occupée", async () => {
    failure = new Error("timeout");
    await expect(tiresService.installTireOnVehicle(mount)).rejects.toThrow("timeout");
  });
});

describe("modification d'un montage : plus d'erreur avalée", () => {
  it("position déjà occupée : AppError 409", async () => {
    const error = await tiresService.updateVehicleTire(1, { position: "front_left" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 409, message: "Cette position est déjà occupée sur le véhicule." });
  });

  it("autre échec : AppError 500 au lieu d'un 200 vide", async () => {
    failure = new Error("timeout");
    const error = await tiresService.updateVehicleTire(1, { notes: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 500 });
  });
});
