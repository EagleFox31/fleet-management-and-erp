import React from "react";
import { motion } from "framer-motion";
import { Loader2, AlertTriangle } from "lucide-react";
import { AnimatedError } from "./animated-error";
import { useAnimatedError } from "@/hooks/use-animated-error";

interface LoadingErrorProps {
  isLoading?: boolean;
  error?: any;
  onRetry?: () => void;
  loadingMessage?: string;
  className?: string;
}

export function LoadingError({ 
  isLoading, 
  error, 
  onRetry, 
  loadingMessage = "Chargement en cours...",
  className = ""
}: LoadingErrorProps) {
  const { handleApiError } = useAnimatedError();

  if (isLoading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={`flex items-center justify-center py-8 ${className}`}
      >
        <div className="text-center space-y-3">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          >
            <Loader2 className="h-8 w-8 text-primary mx-auto" />
          </motion.div>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-sm text-muted-foreground"
          >
            {loadingMessage}
          </motion.p>
        </div>
      </motion.div>
    );
  }

  if (error) {
    const getErrorType = (error: any) => {
      if (error?.status === 401 || error?.status === 403) return "auth";
      if (error?.status === 400 || error?.status === 422) return "validation";
      if (error?.status >= 500) return "server";
      if (error?.name === "NetworkError") return "network";
      if (error?.name === "TimeoutError") return "timeout";
      return "general";
    };

    const getErrorMessage = (error: any) => {
      if (error?.message) return error.message;
      if (error?.status === 404) return "La ressource demandée n'a pas été trouvée";
      if (error?.status === 401) return "Veuillez vous reconnecter";
      if (error?.status === 403) return "Accès non autorisé";
      if (error?.status >= 500) return "Erreur du serveur";
      return "Une erreur s'est produite";
    };

    return (
      <AnimatedError
        type={getErrorType(error)}
        message={getErrorMessage(error)}
        onRetry={onRetry}
        className={className}
      />
    );
  }

  return null;
}