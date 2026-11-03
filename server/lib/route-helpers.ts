import type { NextFunction, Request } from "express";
import { AppError } from "./app-error";
import { withLogContext } from "./error-log-context";
import type { moduleLogger } from "./logger";

/** Plus grand entier d'une colonne `integer` Postgres : au-delà, la requête SQL échouerait en 500. */
const MAX_PG_INTEGER = 2147483647;

/** Identifiant de route : entier strictement positif tenant dans un `integer` Postgres, sinon 400 lisible. */
export function idParam(value: string, label: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id <= 0 || id > MAX_PG_INTEGER) {
    throw new AppError(400, `${label} invalide`);
  }
  return id;
}

/**
 * Fabrique le traitement d'erreur d'un routeur : les AppError et ZodError sont normalisées par le gestionnaire
 * central, le reste devient une 500 générique, journalisée une seule fois par le gestionnaire central.
 */
export function makeFailWith(log: ReturnType<typeof moduleLogger>) {
  return (err: unknown, req: Request, next: NextFunction, logMessage: string) => {
    if (err instanceof AppError) return next(err);
    if (err instanceof Error && err.name === "ZodError") return next(err);
    // Une seule ligne de journal, écrite par `errorHandler` avec ce contexte (AGENTS.md §10) :
    // le module du routeur et le message propre à la route y sont conservés.
    const { module } = (log.bindings?.() ?? {}) as { module?: string };
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: logMessage, module }));
  };
}
