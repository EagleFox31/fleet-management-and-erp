import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodTypeAny } from "zod";
import { toFieldErrors } from "@shared/errors";
import { SERVER_FIELDS, type ServerField } from "@shared/constants/server-fields";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("validate-body");

export interface ValidateBodyOptions {
  /** Champs serveur propres à la route, retirés en plus de `SERVER_FIELDS`. */
  serverFields?: readonly string[];
  /** Champs de `SERVER_FIELDS` que cette route accepte du client (ex. `cost` saisi, `id` d'une sous-entité). */
  keep?: readonly ServerField[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Valide le corps d'une écriture, à placer après la garde de rôle :
 * `router.post("/", isAdmin, validateBody(insertXSchema), handler)`.
 *
 * - Les champs que seul le serveur écrit (`SERVER_FIELDS`, moins `keep`, plus `serverFields`) sont
 *   retirés avant validation, en silence : un client qui renvoie l'objet lu (avec `id`, `createdAt`)
 *   ne reçoit pas de 400, et ces valeurs n'atteignent jamais la base.
 * - Valide : `req.body` devient la sortie du schéma (champs non déclarés retirés, valeurs converties).
 * - Invalide : 400 `VALIDATION`, message lisible de la première erreur, `errors[]` par champ.
 */
export function validateBody(schema: ZodTypeAny, options: ValidateBodyOptions = {}): RequestHandler {
  const keep = new Set<string>(options.keep ?? []);
  const stripped = [...SERVER_FIELDS.filter((field) => !keep.has(field)), ...(options.serverFields ?? [])];

  return (req: Request, _res: Response, next: NextFunction) => {
    let body: unknown = req.body ?? {};
    if (isPlainObject(body)) {
      const removed = stripped.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
      if (removed.length > 0) {
        const copy = { ...(body as Record<string, unknown>) };
        for (const field of removed) delete copy[field];
        body = copy;
        log.debug({ stripped: removed, requestId: req.requestId, method: req.method, path: req.path }, "champs serveur retirés du corps");
      }
    }

    const result = schema.safeParse(body);
    if (!result.success) {
      // `toFieldErrors` passe chaque issue par `describeIssue` : la première donne le message global.
      const fieldErrors = toFieldErrors(result.error.issues);
      return next(
        new AppError(400, fieldErrors?.[0]?.message || "Les données envoyées ne sont pas valides.", {
          fieldErrors,
          cause: result.error,
        }),
      );
    }
    req.body = result.data;
    next();
  };
}
