import { useCallback, useRef } from "react";
import { useLocation } from "wouter";

/**
 * Retour « d'où l'on vient », avec une destination de repli.
 *
 * Les boutons retour de l'app pointaient vers une liste écrite en dur. Or on
 * n'arrive pas toujours d'une liste : une commande fournisseur s'ouvre souvent
 * depuis une demande de pièce, une fiche véhicule depuis une alerte. Renvoyer
 * systématiquement vers la liste fait perdre le contexte — et sur un profil qui
 * n'a pas accès à cette liste, ça envoie sur un écran interdit.
 *
 * On ne remonte l'historique que si l'entrée précédente vient de l'application
 * elle-même : `wouter` navigue en `pushState`, ce qui laisse un `history.state`
 * non nul. Sur une arrivée directe (lien collé, nouvel onglet, retour depuis un
 * site externe), `history.back()` ferait sortir de l'application — on utilise
 * alors le repli.
 */
export function useRetourArriere(repli: string) {
  const [, setLocation] = useLocation();

  // Profondeur d'historique au montage: sert à ne pas remonter au-delà du
  // point d'entrée dans l'application.
  const profondeurInitiale = useRef(
    typeof window === "undefined" ? 0 : window.history.length,
  );

  return useCallback(() => {
    if (typeof window === "undefined") {
      setLocation(repli);
      return;
    }

    const navigationInterne =
      window.history.state !== null && window.history.length > profondeurInitiale.current - 1;

    if (navigationInterne) {
      window.history.back();
      return;
    }

    setLocation(repli);
  }, [repli, setLocation]);
}
