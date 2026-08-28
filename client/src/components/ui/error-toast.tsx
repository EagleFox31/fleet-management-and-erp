import React from 'react';
import { useToast } from '@/hooks/use-toast';
import { AlertCircle, CheckCircle, Info, XCircle } from 'lucide-react';

interface ErrorDetails {
  field?: string;
  message: string;
}

interface ApiError {
  message: string;
  details?: string;
  errors?: ErrorDetails[];
}

export function useErrorHandler() {
  const { toast } = useToast();

  const showError = (error: any, context: string = "Opération") => {
    console.error(`${context} error:`, error);

    let title = "Erreur";
    let description = "Une erreur inattendue s'est produite";
    
    if (error?.response?.data) {
      const apiError: ApiError = error.response.data;
      title = apiError.message || title;
      
      if (apiError.details) {
        description = apiError.details;
      } else if (apiError.errors && apiError.errors.length > 0) {
        description = apiError.errors.map(err => 
          err.field ? `${err.field}: ${err.message}` : err.message
        ).join('\n');
      }
    } else if (error?.message) {
      description = error.message;
    }

    toast({
      variant: "destructive",
      title,
      description,
      duration: 5000,
    });
  };

  const showSuccess = (message: string, title: string = "Succès") => {
    toast({
      title,
      description: message,
      duration: 3000,
      className: "border-green-200 bg-green-50 text-green-900",
    });
  };

  const showWarning = (message: string, title: string = "Attention") => {
    toast({
      title,
      description: message,
      duration: 4000,
      className: "border-orange-200 bg-orange-50 text-orange-900",
    });
  };

  const showInfo = (message: string, title: string = "Information") => {
    toast({
      title,
      description: message,
      duration: 3000,
      className: "border-blue-200 bg-blue-50 text-blue-900",
    });
  };

  return {
    showError,
    showSuccess,
    showWarning,
    showInfo
  };
}

// Composant pour afficher les erreurs de validation en temps réel
interface ValidationErrorsProps {
  errors: ErrorDetails[];
  className?: string;
}

export function ValidationErrors({ errors, className = "" }: ValidationErrorsProps) {
  if (!errors || errors.length === 0) return null;

  return (
    <div className={`bg-red-50 border border-red-200 rounded-md p-3 ${className}`}>
      <div className="flex items-start">
        <XCircle className="h-5 w-5 text-red-400 mt-0.5 mr-2 flex-shrink-0" />
        <div className="text-sm">
          <h3 className="font-medium text-red-800 mb-1">
            Erreurs de validation
          </h3>
          <ul className="text-red-700 space-y-1">
            {errors.map((error, index) => (
              <li key={index} className="flex items-start">
                <span className="mr-2">•</span>
                <span>
                  {error.field && <strong>{error.field}:</strong>} {error.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// Composant de notification de succès inline
interface SuccessMessageProps {
  message: string;
  className?: string;
  onDismiss?: () => void;
}

export function SuccessMessage({ message, className = "", onDismiss }: SuccessMessageProps) {
  return (
    <div className={`bg-green-50 border border-green-200 rounded-md p-3 ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start">
          <CheckCircle className="h-5 w-5 text-green-400 mt-0.5 mr-2 flex-shrink-0" />
          <p className="text-sm text-green-700">{message}</p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-green-400 hover:text-green-600 ml-2"
          >
            <XCircle className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// Composant de message d'information
interface InfoMessageProps {
  message: string;
  className?: string;
}

export function InfoMessage({ message, className = "" }: InfoMessageProps) {
  return (
    <div className={`bg-blue-50 border border-blue-200 rounded-md p-3 ${className}`}>
      <div className="flex items-start">
        <Info className="h-5 w-5 text-blue-400 mt-0.5 mr-2 flex-shrink-0" />
        <p className="text-sm text-blue-700">{message}</p>
      </div>
    </div>
  );
}

// Composant de message d'avertissement
interface WarningMessageProps {
  message: string;
  className?: string;
}

export function WarningMessage({ message, className = "" }: WarningMessageProps) {
  return (
    <div className={`bg-orange-50 border border-orange-200 rounded-md p-3 ${className}`}>
      <div className="flex items-start">
        <AlertCircle className="h-5 w-5 text-orange-400 mt-0.5 mr-2 flex-shrink-0" />
        <p className="text-sm text-orange-700">{message}</p>
      </div>
    </div>
  );
}