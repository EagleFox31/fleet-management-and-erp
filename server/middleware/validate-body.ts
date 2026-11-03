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
  /** Champs de `SERVER_FIELDS` que cette route accepte du client (`cost` saisi, `id` d'une sous-entité). */
  keep?: readonly ServerField[];
}

/** Défauts et enveloppes (`optional`, `default`, `refine`...) retirés pour juger la forme du schéma. */
function unwrap(schema: ZodTypeAny): ZodTypeAny {
  const def = (schema as { _def?: { schema?: ZodTypeAny; innerType?: ZodTypeAny } })._def;
  const inner = def?.schema ?? def?.innerType;
  return inner ? unwrap(inner) : schema;
}

/**
 * Un schéma qui laisse passer des clés non déclarées rend le retrait inutile : `.passthrough()`,
 * `.catchall(...)`, `z.any()`, `z.unknown()`, `z.record(...)`. Refusé à la déclaration de la route.
 */
function permissiveShape(schema: ZodTypeAny): string | undefined {
  const def = (unwrap(schema) as { _def?: { typeName?: string; unknownKeys?: string; catchall?: { _def?: { typeName?: string } } } })._def;
  if (!def) return "schéma inconnu";
  if (def.typeName === "ZodAny" || def.typeName === "ZodUnknown" || def.typeName === "ZodRecord") return def.typeName;
  if (def.typeName === "ZodObject") {
    if (def.unknownKeys === "passthrough") return "passthrough";
    if (def.catchall && def.catchall._def?.typeName !== "ZodNever") return "catchall";
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Valide le corps d'une écriture, à placer après la garde de rôle :
 * `router.post("/", isAdmin, validateBody(insertXSchema), handler)`.
 *
 * - Ordre : garde de rôle, puis `ownedBy` si l'objet est possédé, puis `validateBody`, puis le handler.
 * - Les champs que seul le serveur écrit (`SERVER_FIELDS`, moins `keep`, plus `serverFields`) sont
 *   retirés avant validation, en silence : un client qui renvoie l'objet lu (avec `id`, `createdAt`)
 *   ne reçoit pas de 400, et ces valeurs n'atteignent jamais la base.
 * - Valide : `req.body` devient la sortie du schéma (champs non déclarés retirés, valeurs converties).
 * - Invalide : 400 `VALIDATION`, message lisible de la première erreur, `errors[]` par champ.
 * - Limite : le retrait ne porte que sur le premier niveau ; un objet imbriqué est jugé par son schéma.
 * - Schéma permissif (`passthrough`, `catchall`, `any`, `unknown`, `record`) : erreur au démarrage.
 */
export function validateBody(schema: ZodTypeAny, options: ValidateBodyOptions = {}): RequestHandler {
  const permissive = permissiveShape(schema);
  if (permissive) throw new Error(`validateBody : schéma permissif refusé (${permissive}) ; déclarer les champs acceptés.`);
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
