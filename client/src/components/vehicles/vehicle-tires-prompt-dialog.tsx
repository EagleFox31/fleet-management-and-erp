import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CircleDot } from "lucide-react";

interface VehicleTiresPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registrationNumber: string;
  canOpenTireTracking: boolean;
  canMountFromStock?: boolean;
  onLater: () => void;
  onOpenTireTracking?: () => void;
  onMountFromStock?: () => void;
}

/** Étape optionnelle post-création — choix C : passer sans bloquer la mise en service. */
export function VehicleTiresPromptDialog({
  open,
  onOpenChange,
  registrationNumber,
  canOpenTireTracking,
  canMountFromStock,
  onLater,
  onOpenTireTracking,
  onMountFromStock,
}: VehicleTiresPromptDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleDot className="h-5 w-5 text-amber-600" />
            Pneus déjà montés ?
          </DialogTitle>
          <DialogDescription className="text-left pt-1">
            Le véhicule <span className="font-medium text-foreground">{registrationNumber}</span> est
            actif dans la flotte. Les montages de pneus se renseignent séparément, côté atelier — ce
            n&apos;est pas bloquant pour les missions.
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Tant qu&apos;aucun montage n&apos;est saisi, la fiche affichera « Pneus non renseignés ».
          Vous pourrez compléter plus tard depuis le suivi pneus.
        </p>

        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
          {canMountFromStock && onMountFromStock ? (
            <Button onClick={onMountFromStock}>Monter depuis le stock</Button>
          ) : null}
          {canOpenTireTracking && onOpenTireTracking ? (
            <Button variant="outline" onClick={onOpenTireTracking}>
              Ouvrir le suivi pneus
            </Button>
          ) : null}
          <Button variant={canMountFromStock ? "outline" : "default"} onClick={onLater}>
            Plus tard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
