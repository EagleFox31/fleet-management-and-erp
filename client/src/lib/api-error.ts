import {
  NETWORK_ERROR_MESSAGE,
  STATUS_MESSAGES,
  codeForStatus,
  looksTechnical,
  toFieldErrors,
  withReference,
  type ApiErrorCode,
  type ApiFieldError,
} from "@shared/errors";
import { clientLogger } from "@/lib/logger";

/**
 * Point d'entrée unique des erreurs côté client.
 *
 * `message` est toujours une phrase pour l'utilisateur, jamais un JSON, une
 * trace ni un chemin de champ. Le détail (corps brut, statut, référence) reste
 * sur l'objet pour le développeur et part dans `clientLogger`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly requestId?: string;
  readonly fieldErrors?: ApiFieldError[];
  readonly body: unknown;

  constructor(
    status: number,
    message: string,
    body: unknown,
    extra: { code?: ApiErrorCode; requestId?: string; fieldErrors?: ApiFieldError[] } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.code = extra.code ?? codeForStatus(status);
    this.requestId = extra.requestId;
    this.fieldErrors = extra.fieldErrors;
  }
}

type ParsedError = {
  message: string;
  code: ApiErrorCode;
  requestId?: string;
  fieldErrors?: ApiFieldError[];
};

function parseBody(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Lit une réponse en erreur. Le serveur répond au contrat `ApiErrorBody`
 * (`shared/errors.ts`) ; les anciennes formes `{ error, details }` sont encore
 * comprises, mais rien de technique n'est jamais retenu comme message.
 */
export function parseApiError(status: number, text: string, requestIdHeader?: string | null): ParsedError {
  const body = parseBody(text);
  const code = (typeof body?.code === "string" && body.code in STATUS_MESSAGES ? body.code : codeForStatus(status)) as ApiErrorCode;
  const requestId = (typeof body?.requestId === "string" && body.requestId) || requestIdHeader || undefined;
  const fieldErrors = body ? (toFieldErrors(body.errors) ?? toFieldErrors(body.details)) : undefined;

  if (status >= 500) {
    return { message: withReference(STATUS_MESSAGES.INTERNAL, requestId), code: "INTERNAL", requestId };
  }

  const candidates = [body?.message, body?.error].filter((v): v is string => typeof v === "string");
  const readable = candidates.find((value) => !looksTechnical(value));
  let message = readable?.trim() || STATUS_MESSAGES[code];

  // Un message générique gagne à être précisé par la première erreur de champ.
  if (fieldErrors?.length && (!readable || readable.trim() === STATUS_MESSAGES.VALIDATION)) {
    message = fieldErrors.length === 1 ? fieldErrors[0].message : `${fieldErrors[0].message} (et ${fieldErrors.length - 1} autre${fieldErrors.length > 2 ? "s" : ""} champ${fieldErrors.length > 2 ? "s" : ""} à corriger)`;
  }

  return { message, code, requestId, fieldErrors };
}

/** Compatibilité : message seul. */
export function extractApiErrorMessage(status: number, text: string): string {
  return parseApiError(status, text).message;
}

export async function toApiError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => "");
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  const parsed = parseApiError(res.status, text, res.headers.get("x-request-id"));
  const error = new ApiError(res.status, parsed.message, body, parsed);
  clientLogger.error("Réponse API en erreur", {
    url: res.url,
    status: res.status,
    code: parsed.code,
    requestId: parsed.requestId,
    body,
  });
  return error;
}

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}

/**
 * Message à afficher pour n'importe quelle erreur attrapée (mutation, fetch,
 * exception) : jamais le texte technique d'une exception JavaScript.
 */
export function userMessageOf(error: unknown, fallback: string = STATUS_MESSAGES.INTERNAL): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) return NETWORK_ERROR_MESSAGE;
  if (error instanceof Error && error.message && !looksTechnical(error.message)) return error.message;
  return fallback;
}
