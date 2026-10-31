import { useEffect, useRef } from "react";
import "altcha";
import { AUTH_CHALLENGE_PATH, CAPTCHA_FIELD, CAPTCHA_AFTER_FAILED_ATTEMPTS } from "@shared/contracts/auth-captcha";
import { resolveApiUrl } from "@/lib/queryClient";

export { CAPTCHA_AFTER_FAILED_ATTEMPTS };

/** Vrai quand le défi doit être affiché : seuil du contrat, ou demande du serveur. */
export function shouldShowCaptcha(failedAttempts: number, serverRequires = false): boolean {
  return serverRequires || failedAttempts >= CAPTCHA_AFTER_FAILED_ATTEMPTS;
}

type StateChange = CustomEvent<{ state: string; payload?: string }>;

/**
 * Défi ALTCHA de l'écran de connexion (T-54b). Le parent affiche ce composant
 * seulement derrière le drapeau `captcha` et `shouldShowCaptcha`, et envoie la
 * preuve reçue par `onPayload` dans le champ `captcha` du corps de login.
 * Aucun défi tant que le seuil n'est pas atteint : le formulaire reste utilisable.
 */
export function AltchaWidget({ onPayload }: { onPayload: (payload: string | null) => void }) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onState = (event: Event) => {
      const { state, payload } = (event as StateChange).detail;
      if (state !== "verified") {
        onPayload(null);
        return;
      }
      const hidden = el.closest("form")?.querySelector<HTMLInputElement>(`input[name="${CAPTCHA_FIELD}"]`);
      onPayload(payload ?? hidden?.value ?? null);
    };
    el.addEventListener("statechange", onState);
    return () => el.removeEventListener("statechange", onState);
  }, [onPayload]);

  return (
    <div data-testid="altcha-widget">
      {/* @ts-expect-error élément personnalisé enregistré par le paquet altcha */}
      <altcha-widget ref={ref} challenge={resolveApiUrl(AUTH_CHALLENGE_PATH)} name={CAPTCHA_FIELD} language="fr" />
    </div>
  );
}
