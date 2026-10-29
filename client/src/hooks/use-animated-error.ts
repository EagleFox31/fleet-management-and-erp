import { useState, useCallback } from "react";
import { userMessageOf } from "@/lib/api-error";

export type ErrorType = "network" | "auth" | "validation" | "server" | "timeout" | "general";

interface ErrorState {
  isVisible: boolean;
  type: ErrorType;
  message: string;
  originalError?: any;
}

export function useAnimatedError() {
  const [error, setError] = useState<ErrorState | null>(null);

  const showError = useCallback((message: string, type: ErrorType = "general", originalError?: any) => {
    setError({
      isVisible: true,
      type,
      message,
      originalError
    });
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const handleApiError = useCallback((error: any) => {
    if (!error) {
      showError("Une erreur inconnue s'est produite", "general");
      return;
    }

    // Erreurs réseau
    if (error.name === "NetworkError" || error.code === "NETWORK_ERROR") {
      showError("Impossible de se connecter au serveur", "network", error);
      return;
    }

    // Erreurs de timeout
    if (error.name === "TimeoutError" || error.code === "TIMEOUT") {
      showError("L'opération a pris trop de temps", "timeout", error);
      return;
    }

    // Erreurs HTTP
    if (error.status) {
      switch (error.status) {
        case 401:
          showError("Veuillez vous reconnecter à votre compte", "auth", error);
          break;
        case 403:
          showError("Vous n'avez pas les permissions nécessaires", "auth", error);
          break;
        case 404:
          showError("La ressource demandée n'a pas été trouvée", "general", error);
          break;
        case 422:
        case 400:
          showError(userMessageOf(error, "Les données fournies ne sont pas valides"), "validation", error);
          break;
        case 500:
        case 502:
        case 503:
          // Le message de l'ApiError porte la référence à donner au support.
          showError(userMessageOf(error, "Le serveur rencontre des difficultés temporaires"), "server", error);
          break;
        default:
          showError(userMessageOf(error), "general", error);
      }
      return;
    }

    showError(userMessageOf(error), "general", error);
  }, [showError]);

  const getErrorMessages = useCallback(() => {
    const messages = {
      network: [
        "Oups ! Il semble que la connexion joue à cache-cache 🙈",
        "Le serveur fait une petite pause café ☕",
        "Houston, nous avons un problème de connexion 🚀"
      ],
      auth: [
        "Votre session a pris des vacances ! 🏖️",
        "Il est temps de se reconnecter 🔑",
        "Votre ticket d'entrée a expiré 🎫"
      ],
      validation: [
        "Quelques détails manquent à l'appel 📝",
        "Les données font la grève ! ✊",
        "Il faut remplir tous les champs obligatoires 📋"
      ],
      server: [
        "Le serveur a besoin d'une petite sieste 😴",
        "Nos hamsters font une pause dans leur roue ⚙️",
        "Le serveur jongle avec trop de demandes 🤹"
      ],
      timeout: [
        "L'opération prend son temps... ⏰",
        "Patience, ça charge ! 🐌",
        "Le temps file mais pas assez vite 🕰️"
      ],
      general: [
        "Quelque chose ne va pas comme prévu 🤔",
        "Une petite erreur s'est glissée quelque part 🐛",
        "Ce n'était pas dans le script ! 📜"
      ]
    };

    return messages;
  }, []);

  return {
    error,
    showError,
    clearError,
    handleApiError,
    getErrorMessages
  };
}