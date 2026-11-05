import { userMessageOf } from "@/lib/api-error";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { invalidateDriverCpcDependents } from "@/lib/driver-cpc-invalidation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { GraduationCap, Calendar, Check, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { cpcStatusTone, type CpcStatusTone } from "@shared/constants/driver-cpc-eligibility";

interface CPCUpdateFormProps {
  driverId: number;
  driverName: string;
  currentCPCDate?: string | null;
  currentStatus?: string;
  /** Dans une carte existante (fiche chauffeur) : ni cadre, ni nom, ni badge répétés. */
  embedded?: boolean;
}

export function CPCUpdateForm({ driverId, driverName, currentCPCDate, currentStatus, embedded = false }: CPCUpdateFormProps) {
  const [cpcDate, setCpcDate] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ id, date }: { id: number; date: string }) => {
      const res = await apiRequest("POST", `/api/drivers/${id}/update-cpc`, {
        cpcDate: date,
      });
      return await res.json();
    },
    onSuccess: (_data, { id }) => {
      invalidateDriverCpcDependents(queryClient, id);
      toast({
        title: "Formation CPC mise à jour",
        description: `La certification CPC de ${driverName} a été enregistrée avec succès.`,
      });
      setCpcDate("");
    },
    onError: (error: any) => {
      toast({
        title: "Erreur",
        description: userMessageOf(error, "Impossible de mettre à jour la formation CPC"),
        variant: "destructive",
      });
    },
  });

  const submitCpc = useSingleFlightMutate(mutation.mutate);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!cpcDate) {
      toast({
        title: "Date requise",
        description: "Veuillez sélectionner une date de formation",
        variant: "destructive",
      });
      return;
    }

    const selectedDate = new Date(cpcDate);
    const today = new Date();

    if (selectedDate > today) {
      toast({
        title: "Date invalide",
        description: "La date de formation ne peut pas être dans le futur",
        variant: "destructive",
      });
      return;
    }

    submitCpc({ id: driverId, date: cpcDate });
  };

  const TONE_CLASSES: Record<CpcStatusTone, string> = {
    success: "bg-success/10 text-success border-success/30",
    warning: "bg-warning/10 text-warning-text border-warning/30",
    danger: "bg-destructive/10 text-destructive-text border-destructive/30",
    neutral: "bg-muted text-foreground border-border",
  };
  const getStatusBadge = (status?: string) => TONE_CLASSES[cpcStatusTone(status)];

  return (
    <div
      className={
        embedded
          ? "space-y-3"
          : "p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3 flex flex-col justify-between"
      }
      data-testid={`cpc-update-form-${driverId}`}
    >
      {!embedded && (<div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300 shrink-0">
              <GraduationCap className="h-4 w-4" />
            </div>
            <div>
              <p className="font-bold text-xs text-foreground leading-tight">{driverName}</p>
              <p className="text-[11px] text-muted-foreground">Conducteur</p>
            </div>
          </div>
          {currentStatus && (
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusBadge(
                currentStatus,
              )}`}
            >
              {currentStatus}
            </span>
          )}
        </div>

        {currentCPCDate && (
          <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-[11px] text-muted-foreground flex items-center justify-between">
            <span>Dernière session :</span>
            <span className="font-bold text-foreground">{formatDate(currentCPCDate)}</span>
          </div>
        )}
      </div>)}

      <form onSubmit={handleSubmit} className="space-y-2.5 pt-1">
        <div className="space-y-1">
          <Label htmlFor={`cpc-date-${driverId}`} className="text-[11px] font-semibold text-muted-foreground">
            Nouvelle date de formation
          </Label>
          <div className="relative">
            <Input
              id={`cpc-date-${driverId}`}
              type="date"
              value={cpcDate}
              onChange={(e) => setCpcDate(e.target.value)}
              max={new Date().toISOString().split("T")[0]}
              required
              data-testid={`input-cpc-date-${driverId}`}
              className="h-9 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700"
            />
          </div>
        </div>

        <Button
          type="submit"
          disabled={mutation.isPending || !cpcDate}
          size="sm"
          className="w-full h-8 text-xs font-semibold rounded-xl bg-success text-success-foreground hover:bg-success/90 gap-1.5 cursor-pointer"
          data-testid={`btn-update-cpc-${driverId}`}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Enregistrement…
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5" /> Enregistrer validation
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
