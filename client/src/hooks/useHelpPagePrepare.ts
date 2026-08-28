import { useEffect, useRef } from "react";

type HelpPrepareHandler = () => void;

/**
 * Écoute les actions déclenchées depuis le panneau d'aide (?)
 * Exemple : useHelpPagePrepare({ "wo-tab-parts": () => setActiveTab("parts") })
 */
export function useHelpPagePrepare(handlers: Record<string, HelpPrepareHandler>) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onPrepare = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (!action) return;
      handlersRef.current[action]?.();
    };

    window.addEventListener("fleet-help-prepare", onPrepare);
    return () => window.removeEventListener("fleet-help-prepare", onPrepare);
  }, []);
}
