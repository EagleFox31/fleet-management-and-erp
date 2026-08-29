import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ManagementDashboardInfoTipProps = {
  periodStart: string;
  periodEnd: string;
  previousPeriodStart: string;
  previousPeriodEnd: string;
};

export function ManagementDashboardInfoTip({
  periodStart,
  periodEnd,
  previousPeriodStart,
  previousPeriodEnd,
}: ManagementDashboardInfoTipProps) {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:bg-emerald-50 hover:text-emerald-800"
            aria-label="Période analysée et méthode de calcul"
          >
            <Info className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-xs space-y-2 p-3 text-left">
          <p className="text-xs leading-relaxed">
            <span className="font-semibold text-foreground">Période :</span>{" "}
            du {periodStart} au {periodEnd}.
          </p>
          <p className="text-xs leading-relaxed">
            <span className="font-semibold text-foreground">Comparaison :</span>{" "}
            {previousPeriodStart} → {previousPeriodEnd}.
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Résultat brut en HT : CA facturé moins carburant, maintenance et factures
            fournisseurs.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
