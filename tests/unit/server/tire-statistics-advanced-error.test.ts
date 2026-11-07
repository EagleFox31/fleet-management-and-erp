import { describe, expect, it, vi } from "vitest";

/**
 * `/api/tires/statistics-advanced` : une erreur de base n'est pas un stock vide.
 *
 * Constat du 7 novembre 2026 sur /inventory/tires (compte magasinier) : une requête a attendu
 * une place dans le pool (« timeout exceeded when trying to connect »), le service a attrapé
 * l'erreur et renvoyé 200 avec des zéros. Le magasinier voyait « 0 pneu, valeur 0 » comme une
 * vraie valeur, sans message ni référence.
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
import { AppError } from "../../../server/lib/app-error";

describe("statistiques avancées des pneus : erreur de base", () => {
  it("lève une AppError 5xx au lieu de renvoyer des zéros", async () => {
    const outcome = await tiresService.getTireStatisticsAdvanced().then(
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
    const error = await tiresService.getTireStatisticsAdvanced().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).not.toMatch(/timeout|connect|sql|select/i);
  });
});
