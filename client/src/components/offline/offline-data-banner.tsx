import { useEffect, useState, useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";
import { useFeature } from "@/hooks/use-feature";
import { offlineBannerText, resumeDeadlineFor } from "@/lib/offline-data-banner";
import { getActiveOfflineUserId, subscribeActiveOfflineUser } from "@/lib/offline-user-scope";
import { offlineResume } from "@/lib/offline-kv";
import { clientLogger } from "@/lib/logger";

function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/**
 * Échéance de la session hors ligne (marqueur `offline-resume`), lue seulement sans réseau. Non nulle :
 * les drapeaux étaient allumés au dernier contact, ce qui vaut quand l'appli a démarré hors ligne et que
 * la requête des drapeaux n'a pas pu répondre. Lecture seule : rien n'est écrit, l'échéance ne bouge pas.
 * Le marqueur doit appartenir au compte actif, et l'échéance est appliquée pendant que l'appli tourne.
 */
function useOfflineResumeUntil(online: boolean): number | null {
  const [until, setUntil] = useState<number | null>(null);
  const activeUserId = useSyncExternalStore(subscribeActiveOfflineUser, getActiveOfflineUserId, getActiveOfflineUserId);
  useEffect(() => {
    if (online) {
      setUntil(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    offlineResume
      .peek()
      .then((found) => {
        if (cancelled) return;
        const deadline = resumeDeadlineFor(found, activeUserId, Date.now());
        setUntil(deadline);
        if (deadline !== null) {
          // setTimeout plafonne à ~24 jours ; 72 h tient largement.
          timer = setTimeout(() => setUntil(null), Math.max(0, deadline - Date.now()));
        }
      })
      .catch((err) => clientLogger.warn("Échéance de la session hors ligne illisible", { err }));
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [online, activeUserId]);
  return until;
}

/** Vrai quand la lecture hors ligne est activée (les deux drapeaux, ou le marqueur de reprise) et que l'appareil est sans réseau. */
export function useOfflineReadActive(): boolean {
  const driverOffline = useFeature("driver-offline");
  const offlineWrites = useFeature("offline-writes");
  const online = useOnline();
  const resumeUntil = useOfflineResumeUntil(online);
  return ((driverOffline && offlineWrites) || resumeUntil !== null) && !online;
}

/** Remplace un écran dont les chiffres ne peuvent pas être juste sur la copie réduite gardée hors ligne. */
export function OfflineUnavailable({ what }: { what: string }) {
  return (
    <div role="status" data-testid="offline-unavailable" className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
      {what} : indisponible hors ligne.
    </div>
  );
}

/** Affichage seul : rien si le texte est absent. */
export function OfflineDataBannerView({ text, className }: { text: string | null; className?: string }) {
  if (!text) return null;
  return (
    <div
      role="status"
      data-testid="offline-data-banner"
      className={`flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-sm text-foreground ${className ?? ""}`}
    >
      <WifiOff className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

/**
 * Bandeau « Hors ligne, données du <date/heure> ». `updatedAt` est l'horodatage de la dernière
 * lecture réussie des données affichées (`dataUpdatedAt` de la requête). Absent en ligne, et
 * tant que les drapeaux `driver-offline` et `offline-writes` ne sont pas tous deux allumés.
 */
export function OfflineDataBanner({ updatedAt, className }: { updatedAt: number | undefined | null; className?: string }) {
  const driverOffline = useFeature("driver-offline");
  const offlineWrites = useFeature("offline-writes");
  const online = useOnline();
  const resumeUntil = useOfflineResumeUntil(online);
  const enabled = (driverOffline && offlineWrites) || resumeUntil !== null;
  return (
    <OfflineDataBannerView
      text={enabled ? offlineBannerText({ online, updatedAt, expiresAt: resumeUntil }) : null}
      className={className}
    />
  );
}
