import { useSyncExternalStore } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUpdateAvailable, subscribeUpdateAvailable } from "@/lib/pwa-update";

/** Nouvelle version prête alors qu'un brouillon est en cours : l'utilisateur recharge quand il le décide. */
export function PwaUpdateBanner() {
  const available = useSyncExternalStore(subscribeUpdateAvailable, getUpdateAvailable, () => false);
  if (!available) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-md border bg-card p-3 text-sm text-card-foreground shadow-lg"
    >
      <span className="flex items-center gap-2">
        <RefreshCw className="h-4 w-4 shrink-0 text-primary-text" aria-hidden="true" />
        Nouvelle version disponible.
      </span>
      <Button size="sm" onClick={() => window.location.reload()}>
        Recharger
      </Button>
    </div>
  );
}
