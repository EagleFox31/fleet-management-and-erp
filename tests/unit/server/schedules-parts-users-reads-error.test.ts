import { describe, expect, it, vi } from "vitest";

/**
 * Planning de maintenance, historique d'une pièce, utilisateurs par rôle : une erreur de
 * base n'est pas une liste vide. Ces lectures renvoyaient `[]` : « aucun entretien
 * planifié », « aucune notification à envoyer ». Elles lèvent une AppError 500 ; les
 * notifications qui suivent une écriture passent par `usersByRolesBestEffort`.
 */
const dbFailure = new Error("timeout exceeded when trying to connect");

function failingQuery(): unknown {
  const chain: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (_resolve: unknown, reject: (e: unknown) => void) => reject(dbFailure);
        }
        return () => chain;
      },
    },
  );
  return chain;
}

vi.mock("../../../server/db", () => ({
  db: { select: () => failingQuery(), selectDistinct: () => failingQuery(), execute: () => failingQuery() },
}));

import { storage } from "../../../server/storage";
import { AppError } from "../../../server/lib/app-error";

const READS: Array<[string, () => Promise<unknown>]> = [
  ["getUsersByRole", () => storage.getUsersByRole("admin")],
  ["getMaintenanceSchedules", () => storage.getMaintenanceSchedules()],
  ["getMaintenanceSchedulesByVehicleId", () => storage.getMaintenanceSchedulesByVehicleId(1)],
  ["getPartRequirementsByPartId", () => storage.getPartRequirementsByPartId(1)],
  ["getPartUsageHistory", () => storage.getPartUsageHistory(1)],
  ["getPartWorkOrders", () => storage.getPartWorkOrders(1)],
];

describe("lectures en échec : une erreur, pas un vide", () => {
  it.each(READS)("%s lève une AppError 500 sans fuite technique", async (_name, read) => {
    const error = await read().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.status).toBe(500);
    expect(appError.message).not.toMatch(/timeout|connect/i);
    expect(appError.cause).toBe(dbFailure);
  });
});
