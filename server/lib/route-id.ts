import { MAX_DB_INTEGER_ID } from "@shared/contracts/common";
import { AppError } from "./app-error";

/** Source unique : `shared/contracts/common.ts` (aussi borne des schémas de query et de corps). */
export { MAX_DB_INTEGER_ID };

/**
 * Identifiant lu dans l'URL (`req.params`) : chiffres seuls, entier de 1 à `MAX_DB_INTEGER_ID`,
 * sinon `AppError(400, message)`. `parseInt("12abc")` vaudrait 12 et viserait un autre objet ;
 * `Number("1e3")` ou `Number(" 7 ")` passeraient aussi. Seule lecture d'un id de route.
 */
export function parseRouteId(value: unknown, message: string): number {
  const id = routeIdOrNaN(value);
  if (Number.isNaN(id)) throw new AppError(400, message);
  return id;
}

/**
 * Même lecture que `parseRouteId`, sans lever : `NaN` si l'id est invalide. Réservé à
 * `server/routes.ts` (gelé), dont les handlers testent déjà `isNaN(id)` et répondent 400 :
 * on remplace `parseInt` en place, sans toucher au reste du handler.
 */
export function routeIdOrNaN(value: unknown): number {
  const text = typeof value === "string" ? value : "";
  const id = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(id) || id < 1 || id > MAX_DB_INTEGER_ID) return Number.NaN;
  return id;
}

/**
 * Identifiant de filtre lu dans `req.query` : absent ou vide, pas de filtre (`undefined`) ;
 * sinon même lecture que `parseRouteId` (`AppError(400, message)`). Une valeur répétée
 * (`?vehicleId=1&vehicleId=2`, un tableau) est refusée.
 */
export function parseQueryId(value: unknown, message: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  return parseRouteId(value, message);
}

/** Même lecture que `parseQueryId`, sans lever : `NaN` si l'id est invalide. Réservé à `server/routes.ts` (gelé). */
export function queryIdOrNaN(value: unknown): number | undefined {
  if (value === undefined || value === "") return undefined;
  return routeIdOrNaN(value);
}

/** Message commun aux routes qui lisent un id de mission (`missions`, `operations`). */
export const MISSION_ID_INVALID_MESSAGE = "Identifiant de mission invalide.";
