import { userMessageOf } from "@/lib/api-error";
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
}

export function CPCUpdateForm({ driverId, driverName, currentCPCDate, currentStatus }: CPCUpdateFormProps) {
  const [cpcDate, setCpcDate] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (date: string) => {
      const res = await apiRequest("POST", `/api/drivers/${driverId}/update-cpc`, {
        cpcDate: date,
      });
      return await res.json();
    },
    onSuccess: () => {
      invalidateDriverCpcDependents(queryClient, driverId);
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

    mutation.mutate(cpcDate);
  };

  const TONE_CLASSES: Record<CpcStatusTone, string> = {
    success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200/80",
    warning: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200/80",
    danger: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200/80",
    neutral: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200",
  };
  const getStatusBadge = (status?: string) => TONE_CLASSES[cpcStatusTone(status)];

  return (
    <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3 flex flex-col justify-between">
      <div className="space-y-2">
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
      </div>

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
          className="w-full h-8 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5 cursor-pointer"
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
