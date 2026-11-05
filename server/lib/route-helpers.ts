import type { NextFunction, Request } from "express";
import { AppError } from "./app-error";
import { withLogContext } from "./error-log-context";
import type { moduleLogger } from "./logger";
import { parseRouteId } from "./route-id";

/**
 * Identifiant de route, sinon 400 « <label> invalide ». Délègue à `parseRouteId` : `Number.parseInt`
 * lisait `"12abc"` comme 12 et visait un autre objet (5 novembre 2026).
 */
export function idParam(value: string, label: string): number {
  return parseRouteId(value, `${label} invalide`);
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
    // le module du routeur (`routeModule` : la ligne porte déjà `module` = error-handler) et le
    // message propre à la route y sont conservés.
    const { module } = (log.bindings?.() ?? {}) as { module?: string };
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: logMessage, routeModule: module }));
  };
}
