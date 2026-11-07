import React from "react";
import { motion } from "framer-motion";
import { Loader2, AlertTriangle } from "lucide-react";
import { AnimatedError } from "./animated-error";
import { useAnimatedError } from "@/hooks/use-animated-error";
import { userMessageOf } from "@/lib/api-error";
import { errorTypeOf } from "@/lib/error-type";

interface LoadingErrorProps {
  isLoading?: boolean;
  error?: any;
  onRetry?: () => void;
  /** Un nouvel essai est en cours : le bouton « Réessayer » est désactivé. */
  isRetrying?: boolean;
  loadingMessage?: string;
  className?: string;
}

export function LoadingError({ 
  isLoading, 
  error, 
  onRetry,
  isRetrying = false,
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
            <Loader2 className="h-8 w-8 text-primary-text mx-auto" />
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
    const getErrorMessage = (error: any) => {
      return userMessageOf(error, "Le chargement a échoué. Réessayez dans un instant.");
    };

    return (
      <AnimatedError
        type={errorTypeOf(error)}
        message={getErrorMessage(error)}
        onRetry={onRetry}
        isRetrying={isRetrying}
        className={className}
      />
    );
  }

  return null;
}