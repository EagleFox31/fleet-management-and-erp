import type { NextFunction, Request, Response } from "express";
import { requireFeature } from "../lib/feature-flags";
import { canExport } from "../../shared/contracts/exports";
import { AppError } from "../lib/app-error";
import { isAnyUser } from "./auth";

/** Refus par defaut : chemin absent de EXPORT_ROLE_MATRIX ou role non liste = 403. */
const matrixCheck = (req: Request, _res: Response, next: NextFunction) => {
  const segment = req.path.split("/").filter(Boolean)[0] ?? "";
  if (!canExport(req.user?.role, segment)) {
    return next(new AppError(403, "Votre profil ne permet pas cet export."));
  }
  next();
};

export const exportsGuard = [requireFeature("exports"), isAnyUser, matrixCheck];
