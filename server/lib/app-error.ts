import { codeForStatus, type ApiErrorCode, type ApiFieldError } from "@shared/errors";

/**
 * Erreur métier levée volontairement, de n'importe quelle couche (route,
 * service, storage). Son `message` est rédigé pour l'utilisateur ; `cause`
 * garde le détail technique, qui ne part qu'aux logs.
 *
 * Le gestionnaire central (`server/middleware/error-handler.ts`) la convertit
 * en réponse `ApiErrorBody` avec le bon statut.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fieldErrors?: ApiFieldError[];

  constructor(
    status: number,
    message: string,
    options: { code?: ApiErrorCode; fieldErrors?: ApiFieldError[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.status = status;
    this.code = options.code ?? codeForStatus(status);
    this.fieldErrors = options.fieldErrors;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
