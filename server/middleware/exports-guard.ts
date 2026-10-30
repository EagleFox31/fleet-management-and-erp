import type { NextFunction, Request, Response } from "express";
import { resolveFeatureFlags } from "../../shared/feature-flags";
import { canExport } from "../../shared/contracts/exports";
import { AppError } from "../lib/app-error";
import { isAnyUser } from "./auth";

/** Coupe-circuit `exports` : 404 quand le drapeau est coupe (a remplacer par requireFeature de T-08). */
export function exportsFeatureGate(req: Request, _res: Response, next: NextFunction) {
  if (!resolveFeatureFlags(process.env.FEATURE_FLAGS).exports) {
    return next(new AppError(404, "Fonction indisponible."));
  }
  next();
}

/** Refus par defaut : chemin absent de EXPORT_ROLE_MATRIX ou role non liste = 403. */
const matrixCheck = (req: Request, _res: Response, next: NextFunction) => {
  const segment = req.path.split("/").filter(Boolean)[0] ?? "";
  if (!canExport(req.user?.role, segment)) {
    return next(new AppError(403, "Votre profil ne permet pas cet export."));
  }
  next();
};

export const exportsGuard = [exportsFeatureGate, isAnyUser, matrixCheck];
