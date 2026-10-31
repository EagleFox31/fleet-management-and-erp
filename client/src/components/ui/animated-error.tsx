import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Wifi, Database, Key, Clock, RefreshCw, Lightbulb, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ErrorType } from "@/lib/error-type";

interface AnimatedErrorProps {
  type: ErrorType;
  message: string;
  onRetry?: () => void;
  className?: string;
}

export const errorConfig: Record<ErrorType, { icon: typeof AlertCircle; color: string; bgColor: string; borderColor: string; title: string; suggestions: string[] }> = {
  network: {
    icon: Wifi,
    color: "text-orange-500",
    bgColor: "bg-orange-50 dark:bg-orange-950/20",
    borderColor: "border-orange-200 dark:border-orange-800",
    title: "Problème de connexion",
    suggestions: [
      "Vérifiez votre connexion Internet",
      "Le serveur est peut-être temporairement indisponible",
      "Essayez de rafraîchir la page"
    ]
  },
  auth: {
    icon: Key,
    color: "text-red-500",
    bgColor: "bg-red-50 dark:bg-red-950/20",
    borderColor: "border-red-200 dark:border-red-800",
    title: "Authentification requise",
    suggestions: [
      "Votre session a peut-être expiré",
      "Reconnectez-vous à votre compte",
      "Vérifiez vos identifiants"
    ]
  },
  // 403 : la session est valide, le profil n'a pas le droit. Se reconnecter n'y change rien.
  permission: {
    icon: ShieldAlert,
    color: "text-amber-600",
    bgColor: "bg-amber-50 dark:bg-amber-950/20",
    borderColor: "border-amber-200 dark:border-amber-800",
    title: "Accès refusé",
    suggestions: [
      "Votre profil n'a pas accès à cette ressource",
      "Si vous en avez besoin, demandez l'accès à un administrateur"
    ]
  },
  validation: {
    icon: AlertCircle,
    color: "text-yellow-500",
    bgColor: "bg-yellow-50 dark:bg-yellow-950/20",
    borderColor: "border-yellow-200 dark:border-yellow-800",
    title: "Données incomplètes",
    suggestions: [
      "Vérifiez que tous les champs requis sont remplis",
      "Les données saisies doivent être valides",
      "Consultez les indications d'aide"
    ]
  },
  server: {
    icon: Database,
    color: "text-purple-500",
    bgColor: "bg-purple-50 dark:bg-purple-950/20",
    borderColor: "border-purple-200 dark:border-purple-800",
    title: "Erreur serveur",
    suggestions: [
      "Le serveur rencontre un problème temporaire",
      "Attendez quelques instants avant de réessayer",
      "Contactez le support si le problème persiste"
    ]
  },
  timeout: {
    icon: Clock,
    color: "text-blue-500",
    bgColor: "bg-blue-50 dark:bg-blue-950/20",
    borderColor: "border-blue-200 dark:border-blue-800",
    title: "Délai d'attente dépassé",
    suggestions: [
      "L'opération prend plus de temps que prévu",
      "Votre connexion est peut-être lente",
      "Essayez de nouveau dans quelques instants"
    ]
  },
  general: {
    icon: AlertCircle,
    color: "text-gray-500",
    bgColor: "bg-gray-50 dark:bg-gray-950/20",
    borderColor: "border-gray-200 dark:border-gray-800",
    title: "Une erreur s'est produite",
    suggestions: [
      "Quelque chose ne s'est pas déroulé comme prévu",
      "Essayez de rafraîchir la page",
      "Contactez le support si nécessaire"
    ]
  }
};

export function AnimatedError({ type, message, onRetry, className = "" }: AnimatedErrorProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const config = errorConfig[type];
  const IconComponent = config.icon;

  useEffect(() => {
    setIsVisible(true);
    const timer = setTimeout(() => setShowSuggestions(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className={className}
        >
          <Alert className={`${config.bgColor} ${config.borderColor} border-2`}>
            <div className="flex items-start gap-3">
              <motion.div
                initial={{ rotate: 0 }}
                animate={{ rotate: [0, -10, 10, -5, 5, 0] }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className={config.color}
              >
                <IconComponent className="h-5 w-5" />
              </motion.div>
              
              <div className="flex-1 space-y-2">
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <h4 className="font-semibold text-foreground">{config.title}</h4>
                  <AlertDescription className="text-sm text-muted-foreground">
                    {message}
                  </AlertDescription>
                </motion.div>

                <AnimatePresence>
                  {showSuggestions && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3 }}
                      className="space-y-1"
                    >
                      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-2">
                        <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
                        Suggestions :
                      </p>
                      {config.suggestions.map((suggestion, index) => (
                        <motion.div
                          key={index}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.1 * index }}
                          className="text-xs text-muted-foreground flex items-center gap-2"
                        >
                          <span className="w-1 h-1 bg-current rounded-full" />
                          {suggestion}
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                {onRetry && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                    className="pt-2"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onRetry}
                      className="h-8 text-xs"
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Réessayer
                    </Button>
                  </motion.div>
                )}
              </div>
            </div>
          </Alert>
        </motion.div>
      )}
    </AnimatePresence>
  );
}