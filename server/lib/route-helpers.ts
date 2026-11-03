import type { NextFunction, Request } from "express";
import { AppError } from "./app-error";
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
 * central, le reste est journalisé (requestId) puis devient une 500 générique.
 */
export function makeFailWith(log: ReturnType<typeof moduleLogger>) {
  return (err: unknown, req: Request, next: NextFunction, logMessage: string) => {
    if (err instanceof AppError) return next(err);
    if (err instanceof Error && err.name === "ZodError") return next(err);
    log.error({ err, requestId: req.requestId }, logMessage);
    return next(new AppError(500, "Erreur serveur", { cause: err }));
  };
}
