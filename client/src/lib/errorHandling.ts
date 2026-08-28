import { useToast } from '@/hooks/use-toast';

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

// Fonction pour transformer les erreurs brutes en erreurs d'application
export function handleError(error: any): AppError {
  // Si c'est déjà une AppError, la retourner
  if (error && 'type' in error && 'message' in error) {
    return error as AppError;
  }

  // Erreurs de réseau (fetch)
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return createAppError(
      ErrorType.NETWORK,
      'Erreur de connexion au serveur',
      'Veuillez vérifier votre connexion Internet',
      error
    );
  }

  // Erreurs HTTP avec statut
  if (error && error.status) {
    switch (error.status) {
      case 400:
        return createAppError(
          ErrorType.VALIDATION,
          'Données invalides',
          error.data || 'Les données fournies ne sont pas valides',
          error
        );
      case 401:
        return createAppError(
          ErrorType.AUTHENTICATION,
          'Non authentifié',
          'Veuillez vous connecter pour accéder à cette ressource',
          error
        );
      case 403:
        return createAppError(
          ErrorType.PERMISSION,
          'Accès refusé',
          'Vous n\'avez pas les permissions nécessaires',
          error
        );
      case 404:
        return createAppError(
          ErrorType.NOT_FOUND,
          'Ressource non trouvée',
          'La ressource demandée n\'existe pas',
          error
        );
      case 409:
        return createAppError(
          ErrorType.CONFLICT,
          'Conflit de données',
          'Cette opération entre en conflit avec l\'état actuel',
          error
        );
      case 500:
      case 502:
      case 503:
      case 504:
        return createAppError(
          ErrorType.SERVER,
          'Erreur serveur',
          'Une erreur est survenue sur le serveur',
          error
        );
    }
  }

  // Erreurs génériques
  return createAppError(
    ErrorType.UNKNOWN,
    'Erreur inattendue',
    error.message || 'Une erreur inconnue est survenue',
    error
  );
}

// Hook pour afficher les erreurs avec le toast
export function useErrorHandler() {
  const { toast } = useToast();

  // Fonction pour afficher les erreurs
  const showError = (error: any) => {
    const appError = handleError(error);
    
    toast({
      title: appError.message,
      description: typeof appError.details === 'string' 
        ? appError.details 
        : 'Détails: ' + JSON.stringify(appError.details),
      variant: 'destructive',
    });
    
    // Logger l'erreur dans la console
    console.error('[Error]', appError.type, appError);
  };

  return { showError };
}

// Fonction pour logger les erreurs côté serveur
export function logServerError(error: any, context: string) {
  console.error(`[Server Error - ${context}]`, error);
}