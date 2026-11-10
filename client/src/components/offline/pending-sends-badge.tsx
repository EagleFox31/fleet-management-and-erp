import { CloudUpload, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useOfflineQueue } from "@/hooks/use-offline-queue";

/**
 * Pastille « N envois en attente » / « N à revoir ». Ne s'affiche que s'il y a quelque chose
 * à dire, donc jamais tant que les drapeaux hors ligne sont éteints (la file reste vide).
 * Composant réutilisable, pas encore posé sur un écran métier (lots V5b-3 et #10c).
 */
export function PendingSendsBadge({ className }: { className?: string }) {
  const { waiting, rejected } = useOfflineQueue();
  if (waiting === 0 && rejected === 0) return null;
  return (
    <span className={className} data-testid="pending-sends-badge">
      {waiting > 0 && (
        <Badge variant="secondary" className="gap-1">
          <CloudUpload className="h-3 w-3" aria-hidden="true" />
          {waiting} {waiting > 1 ? "envois en attente" : "envoi en attente"}
        </Badge>
      )}
      {rejected > 0 && (
        <Badge variant="destructive" className="ml-1 gap-1">
          <TriangleAlert className="h-3 w-3" aria-hidden="true" />
          {rejected} à revoir
        </Badge>
      )}
    </span>
  );
}
