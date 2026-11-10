import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useFeature } from "@/hooks/use-feature";
import { offlineBannerText } from "@/lib/offline-data-banner";

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
  const enabled = driverOffline && offlineWrites;
  return <OfflineDataBannerView text={enabled ? offlineBannerText({ online, updatedAt }) : null} className={className} />;
}
