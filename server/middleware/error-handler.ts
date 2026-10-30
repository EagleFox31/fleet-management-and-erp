import type { NextFunction, Request, Response } from "express";
import { nanoid } from "nanoid";
import { ZodError } from "zod";
import {
  STATUS_MESSAGES,
  codeForStatus,
  looksTechnical,
  toFieldErrors,
  withReference,
  type ApiErrorBody,
  type ApiErrorCode,
  type ApiFieldError,
} from "@shared/errors";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";

export { AppError } from "../lib/app-error";

/** Clés du contrat `ApiErrorBody` : `AppError.details` ne peut pas les écraser. */
export const RESERVED_ERROR_KEYS = ["message", "code", "requestId", "errors"] as const;

/** Fusionne les `details` d'une `AppError` dans un corps normalisé, sans toucher aux clés réservées. */
export function mergeErrorDetails<T extends object>(body: T, details: Record<string, unknown> | undefined): T {
  if (!details) return body;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!(RESERVED_ERROR_KEYS as readonly string[]).includes(key)) extra[key] = value;
  }
  return { ...extra, ...body };
}

const log = moduleLogger("http");

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

function userIdOf(req: Request): number | undefined {
  return (req as Request & { user?: { id?: number } }).user?.id;
}

/** Identifiant de corrélation : renvoyé au client, présent dans chaque log. */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get("x-request-id");
  req.requestId = incoming && /^[\w-]{6,64}$/.test(incoming) ? incoming : nanoid(10);
  res.setHeader("X-Request-Id", req.requestId);
  next();
}

/** Journal d'accès des routes /api : une ligne par requête, sans le corps. */
export function accessLog(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api")) return next();
  const start = Date.now();
  res.on("finish", () => {
    const entry = {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - start,
      userId: userIdOf(req),
    };
    if (res.statusCode >= 500) log.error(entry, "requête en échec");
    else if (res.statusCode >= 400) log.warn(entry, "requête refusée");
    else log.info(entry, "requête traitée");
  });
  next();
}

/** Message affichable tiré d'un corps de réponse historique, ou null. */
function readableMessage(body: Record<string, unknown>): string | null {
  for (const key of ["message", "error"] as const) {
    const value = body[key];
    if (typeof value === "string" && !looksTechnical(value)) return value.trim();
  }
  return null;
}

/**
 * Met au contrat `ApiErrorBody` un corps d'erreur écrit par une route.
 *
 * - 5xx : message générique + référence, toujours. Le corps d'origine (qui
 *   contient souvent `error.message`) n'est conservé que dans les logs.
 * - 4xx : le message de la route s'il est lisible, sinon le message du statut ;
 *   les issues Zod (`errors` / `details`) deviennent des champs en français.
 */
export function normalizeErrorBody(status: number, raw: unknown, requestId?: string): ApiErrorBody {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const code = (typeof body.code === "string" && body.code in STATUS_MESSAGES ? body.code : codeForStatus(status)) as ApiErrorCode;

  if (status >= 500) {
    return { message: withReference(STATUS_MESSAGES.INTERNAL, requestId), code: "INTERNAL", requestId };
  }

  const errors = toFieldErrors(body.errors) ?? toFieldErrors(body.details);
  const message = readableMessage(body) ?? STATUS_MESSAGES[code];
  return errors ? { message, code, requestId, errors } : { message, code, requestId };
}

/**
 * Garde de sortie : toute réponse d'erreur passe par `normalizeErrorBody`,
 * y compris celles des routes historiques qui font
 * `res.status(500).json({ error: error.message })`.
 */
export function errorResponseGuard(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode < 400) return originalJson(body);
    const normalized = normalizeErrorBody(res.statusCode, body, req.requestId);
    if (res.statusCode >= 500) {
      log.error({ requestId: req.requestId, method: req.method, path: req.path, userId: userIdOf(req), body }, "erreur serveur renvoyée par la route");
    }
    const details = res.locals?.appErrorDetails as Record<string, unknown> | undefined;
    return originalJson(res.statusCode < 500 ? mergeErrorDetails(normalized, details) : normalized);
  };
  next();
}

export function toHttpError(err: unknown): {
  status: number;
  message?: string;
  fieldErrors?: ApiFieldError[];
  details?: Record<string, unknown>;
} {
  if (err instanceof AppError) {
    return { status: err.status, message: err.message, fieldErrors: err.fieldErrors, details: err.details };
  }
  if (err instanceof ZodError) return { status: 400, fieldErrors: toFieldErrors(err.issues) };
  const e = err as { status?: number; statusCode?: number; type?: string };
  // express.json() sur un corps mal formé
  if (e?.type === "entity.parse.failed") return { status: 400, message: "Les données envoyées sont illisibles." };
  if (e?.type === "entity.too.large") return { status: 413, message: "Les données envoyées sont trop volumineuses." };
  const status = e?.status ?? e?.statusCode ?? 500;
  return { status: status >= 400 && status < 600 ? status : 500 };
}

/** Dernier middleware : erreurs levées (`throw`, `next(err)`) et non rattrapées. */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);
  const { status, message, fieldErrors, details } = toHttpError(err);
  const context = { requestId: req.requestId, method: req.method, path: req.path, userId: userIdOf(req), status, err };
  if (status >= 500) log.error(context, "erreur non gérée");
  else log.warn(context, "requête rejetée");

  // Transmis à la garde de sortie, qui normalise le corps puis y fusionne les détails.
  if (details && res.locals) res.locals.appErrorDetails = details;
  res.status(status).json({ message, errors: fieldErrors });
}
