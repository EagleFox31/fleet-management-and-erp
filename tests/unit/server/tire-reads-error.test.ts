import { describe, expect, it, vi } from "vitest";

/**
 * Lectures de `tires-service-simplified` : une erreur de base n'est pas une liste vide.
 *
 * Suite du constat du 7 novembre 2026 (statistics-advanced, #591) : ces lectures attrapaient
 * l'erreur et renvoyaient `[]`, `{ tires: [], total: 0 }` ou des zéros. La route répondait 200 et
 * l'écran affichait « aucun pneu » comme une vraie valeur. Elles lèvent désormais une AppError 5xx ;
 * toutes les routes appelantes ont un catch qui répond 500.
 */
const dbFailure = new Error("timeout exceeded when trying to connect");

/** Chaîne Drizzle factice : toute méthode renvoie la chaîne, l'attente rejette. */
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

vi.mock("../../../server/db", () => ({ db: { select: () => failingQuery() } }));

import { tiresService } from "../../../server/services/tires-service-simplified";
import { storage } from "../../../server/storage";
import { AppError } from "../../../server/lib/app-error";

const READS: Array<[string, () => Promise<unknown>]> = [
  ["getTires", () => tiresService.getTires({ limit: 20, offset: 0 })],
  ["getAllVehicleTires", () => tiresService.getAllVehicleTires(null)],
  ["getVehicleTires", () => tiresService.getVehicleTires(1)],
  ["getTireInspections", () => tiresService.getTireInspections()],
  ["getTireRotations", () => tiresService.getTireRotations()],
  ["getTireStatistics", () => tiresService.getTireStatistics()],
  ["getLowStockTires", () => tiresService.getLowStockTires()],
  ["storage.getTireRotationsForWorkOrder", () => storage.getTireRotationsForWorkOrder(1)],
];

describe("lectures pneus : erreur de base", () => {
  it.each(READS)("%s lève une AppError 5xx au lieu d'un résultat vide", async (_name, read) => {
    const outcome = await read().then(
      (value: unknown) => ({ value }),
      (error: unknown) => ({ error }),
    );

    expect(outcome).not.toHaveProperty("value");
    const { error } = outcome as { error: unknown };
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBeGreaterThanOrEqual(500);
    expect((error as AppError).cause).toBe(dbFailure);
    expect((error as AppError).message).not.toMatch(/timeout|connect|sql|select/i);
  });
});
