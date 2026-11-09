import { describe, expect, it, vi } from "vitest";

/**
 * Lectures d'argent et de stock : une erreur de base n'est pas une liste vide ni un zéro.
 *
 * Ces lectures attrapaient l'erreur et renvoyaient `[]`, `{ parts: [], total: 0 }` ou `0`. La route
 * répondait 200 et l'écran affichait « aucune pièce », « aucun mouvement » ou un coût de 0 comme de
 * vraies valeurs (valeur du stock, coût pièces d'un OT, coût de maintenance). Elles lèvent désormais
 * une AppError 5xx ; toutes les routes appelantes ont un catch qui répond 500.
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

vi.mock("../../../server/db", () => ({
  db: { select: () => failingQuery(), selectDistinct: () => failingQuery(), execute: () => failingQuery() },
}));

import { partRequirementsService } from "../../../server/services/part-requirements-service";
import { storage } from "../../../server/storage";
import { AppError } from "../../../server/lib/app-error";

const READS: Array<[string, () => Promise<unknown>]> = [
  ["storage.getParts", () => storage.getParts()],
  ["storage.getAllStockMovements", () => storage.getAllStockMovements()],
  ["storage.getPartStockHistory", () => storage.getPartStockHistory(1)],
  ["storage.getPartsUsedForWorkOrder", () => storage.getPartsUsedForWorkOrder(1)],
  ["storage.getAllPartsUsed", () => storage.getAllPartsUsed()],
  ["storage.getMaintenanceCost", () => storage.getMaintenanceCost("month")],
  ["partRequirementsService.getPartRequirements", () => partRequirementsService.getPartRequirements()],
  ["partRequirementsService.getRequirementsByPartId", () => partRequirementsService.getRequirementsByPartId(1)],
];

describe("lectures argent et stock : erreur de base", () => {
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
