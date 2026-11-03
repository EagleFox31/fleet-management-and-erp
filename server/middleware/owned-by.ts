import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "../lib/app-error";
import { canAccessOwned, OUT_OF_SCOPE_MESSAGE } from "../lib/client-scope";
import { isAnyUser } from "./auth";

/**
 * Garde d'un objet possédé par un client (AGENTS.md §11) : tout utilisateur connecté, mais un client
 * n'atteint que ses propres objets. `resolveOwner` lit le propriétaire (`vehicles.ownerId`...) ; il n'est
 * appelé que pour un client. Hors périmètre : 403.
 *
 * Sert aux LECTURES : `router.get("/:id", ...ownedBy((req) => ownerOfVehicle(Number(req.params.id))), handler)`.
 * Le cliquet T1 ne le compte pas comme garde : une écriture porte une vraie garde de rôle (un client
 * ne saisit rien sur son véhicule, AGENTS.md §11). `resolveOwner` et le handler lisent le même
 * identifiant, à la même source (`req.params.id`) : sinon le contrôle porte sur un objet et l'action
 * sur un autre.
 */
export function ownedBy(
  resolveOwner: (req: Request) => Promise<number | null | undefined>,
  message: string = OUT_OF_SCOPE_MESSAGE,
): RequestHandler[] {
  const check: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const allowed = await canAccessOwned(req.user as { id: number; role: string } | undefined, () => resolveOwner(req));
      next(allowed ? undefined : new AppError(403, message));
    } catch (error) {
      next(error);
    }
  };
  return [isAnyUser, check];
}

/**
 * Garde explicite d'une route qui n'agit que sur l'utilisateur connecté (préférences, mot de passe,
 * onboarding) : tous les rôles, aucun identifiant pris dans l'URL. Le cliquet T1 l'accepte comme garde
 * seulement si le handler ne lit pas `req.params`.
 */
export const selfScoped: RequestHandler = isAnyUser;
