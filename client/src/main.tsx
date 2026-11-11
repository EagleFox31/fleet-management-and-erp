import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
// Utiliser l'alias "@" comme TOUS les autres importeurs (dont useRealTimeSync).
// Avec le chemin relatif, Vite instanciait le module deux fois: le provider et
// la synchro temps réel travaillaient sur deux QueryClient distincts, et toutes
// les invalidations/patches temps réel tombaient dans un client fantôme.
import { queryClient } from "@/lib/queryClient";
import { registerPwaServiceWorker } from "@/lib/pwa-register";
import { PwaUpdateBanner } from "@/components/pwa-update-banner";
import { enableMocksIfRequested, mocksRequested } from "@/mocks/enable-mocks";
import "./index.css";

// Enregistrement PWA Service Worker (Hors-Ligne + Installation Mobile)
// Le worker msw et le worker PWA se disputent la même portée : pas de PWA en mode mock.
if (!mocksRequested()) registerPwaServiceWorker();

void enableMocksIfRequested().finally(() => {
  createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
    <PwaUpdateBanner />
  </QueryClientProvider>,
  );
});

