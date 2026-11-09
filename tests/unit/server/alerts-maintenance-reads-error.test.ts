import { describe, expect, it, vi } from "vitest";

/**
 * Lectures d'alertes, de demandes de pièces, de catalogue de pannes et de maintenance :
 * une erreur de base n'est ni une liste vide ni un zéro. Elles levaient `[]`, `0` ou
 * `{ compliant: 0, overdue: 0, total: 0 }` ; la route répondait 200 et l'écran affichait
 * « 0 non lue », « aucune demande » ou une conformité à 0. Elles lèvent une AppError 500
 * (les routes appelantes ont un catch qui répond 500).
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
  ["getPartRequirements", () => storage.getPartRequirements()],
  ["getFaultCatalogs", () => storage.getFaultCatalogs()],
  ["getMaintenanceCompliance", () => storage.getMaintenanceCompliance()],
  ["getScheduledMaintenanceCount", () => storage.getScheduledMaintenanceCount("week")],
  ["getAlertsByUserId", () => storage.getAlertsByUserId(1)],
  ["getUnreadAlertsByUserId", () => storage.getUnreadAlertsByUserId(1)],
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
