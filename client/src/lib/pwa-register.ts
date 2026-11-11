import { clientLogger } from "@/lib/logger";
import { createControllerChangeHandler, hasNonEmptyDraft, markUpdateAvailable } from "@/lib/pwa-update";

// Enregistrement du Service Worker PWA
//
// Le worker sert les modules depuis le cache sans les revalider. C'est sans risque en
// production (bundles à empreinte) mais, avec le serveur de développement Vite, un module
// source (/src/*.tsx) garderait son ancienne version : une modification du code resterait
// invisible au rechargement. En développement, aucun worker n'est donc enregistré et ceux
// déjà installés sont retirés. Opt-in explicite : VITE_ENABLE_SW=1 (spec e2e 13).

/** Préfixe commun de `CACHE_NAME` (sw.js) et des stockages hors ligne par utilisateur. */
const APP_CACHE_PREFIX = 'fleetos-';

export interface PwaRegisterOptions {
  /** Build de production (import.meta.env.PROD). */
  isProd: boolean;
  /** Opt-in en développement (import.meta.env.VITE_ENABLE_SW === "1"). */
  forceEnable?: boolean;
}

export function shouldRegisterServiceWorker({ isProd, forceEnable }: PwaRegisterOptions): boolean {
  return isProd || forceEnable === true;
}

export function registerPwaServiceWorker(
  options: PwaRegisterOptions = {
    isProd: import.meta.env.PROD,
    forceEnable: import.meta.env.VITE_ENABLE_SW === '1',
  },
): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  if (!shouldRegisterServiceWorker(options)) {
    // Purge des postes déjà contaminés par un worker enregistré en développement :
    // désinscription, puis suppression des seuls caches de l'application (préfixe
    // "fleetos-", dont le cache statique). Les autres caches du navigateur sont intacts.
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then(async () => {
        if (typeof caches === 'undefined') return;
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name.startsWith(APP_CACHE_PREFIX)).map((name) => caches.delete(name)));
      })
      .catch(() => {});
    return;
  }

  // Un nouveau worker prend le contrôle (skipWaiting + claim) : la page tourne sur l'ancien build.
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    createControllerChangeHandler({
      hadController: navigator.serviceWorker.controller !== null,
      hasDraft: () => hasNonEmptyDraft(),
      reload: () => window.location.reload(),
      onUpdateAvailable: markUpdateAvailable,
    }),
  );

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Service Worker enregistré avec succès
        registration.onupdatefound = () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
            installingWorker.onstatechange = () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // Nouvelle mise à jour disponible
              }
            };
          }
        };
      })
      .catch((error) => {
        clientLogger.warn('[PWA] Service Worker registration failed', { error });
      });
  });
}
