import { useToast } from '@/hooks/use-toast';
import { NETWORK_ERROR_MESSAGE } from '@shared/errors';
import { ApiError, userMessageOf } from '@/lib/api-error';
import { clientLogger } from '@/lib/logger';

// Types d'erreur standard pour l'application
export enum ErrorType {
  VALIDATION = 'validation',
  NETWORK = 'network',
  AUTHENTICATION = 'authentication',
  PERMISSION = 'permission',
  NOT_FOUND = 'not_found',
  CONFLICT = 'conflict',
  SERVER = 'server',
  UNKNOWN = 'unknown',
}

// Interface pour les erreurs standardisées
export interface AppError {
  type: ErrorType;
  message: string;
  details?: string | Record<string, any>;
  originalError?: any;
}

// Fonction pour créer une erreur d'application standardisée
export function createAppError(
  type: ErrorType,
  message: string,
  details?: string | Record<string, any>,
  originalError?: any
): AppError {
  return {
    type,
    message,
    details,
    originalError,
  };
}

const TYPE_BY_CODE: Record<ApiError['code'], ErrorType> = {
  VALIDATION: ErrorType.VALIDATION,
  UNAUTHENTICATED: ErrorType.AUTHENTICATION,
  FORBIDDEN: ErrorType.PERMISSION,
  NOT_FOUND: ErrorType.NOT_FOUND,
  CONFLICT: ErrorType.CONFLICT,
  VEHICLE_RETIRED: ErrorType.CONFLICT,
  IDEMPOTENCY_IN_PROGRESS: ErrorType.CONFLICT,
  INCIDENT_WRITE_FAILED: ErrorType.SERVER,
  INCIDENT_VEHICLE_NOT_FOUND: ErrorType.NOT_FOUND,
  RATE_LIMITED: ErrorType.CONFLICT,
  INTERNAL: ErrorType.SERVER,
};

/**
 * Transforme une erreur quelconque en `AppError` affichable.
 * Le message vient de `api-error.ts`, seule source des textes d'erreur API.
 */
export function handleError(error: any): AppError {
  if (error && typeof error === 'object' && 'type' in error && 'message' in error && !(error instanceof Error)) {
    return error as AppError;
  }

  if (error instanceof ApiError) {
    const details = error.fieldErrors?.length && error.fieldErrors.length > 1
      ? error.fieldErrors.map((f) => f.message).join(' ')
      : undefined;
    return createAppError(TYPE_BY_CODE[error.code], error.message, details, error);
  }

  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
    return createAppError(ErrorType.NETWORK, NETWORK_ERROR_MESSAGE, undefined, error);
  }

  return createAppError(ErrorType.UNKNOWN, userMessageOf(error), undefined, error);
}

// Hook pour afficher les erreurs avec le toast
export function useErrorHandler() {
  const { toast } = useToast();

  const showError = (error: any, title = 'Action impossible') => {
    const appError = handleError(error);

    toast({
      title,
      description: typeof appError.details === 'string'
        ? `${appError.message} ${appError.details}`
        : appError.message,
      variant: 'destructive',
    });

    clientLogger.error('Erreur affichée à l\'utilisateur', { type: appError.type, error: appError.originalError });
  };

  return { showError };
}

export function logServerError(error: any, context: string) {
  clientLogger.error(`Erreur ${context}`, { error });
}
