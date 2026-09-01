import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/utils";
import { UserCheck, AlertTriangle, ShieldCheck, Clock, Calendar, AlertCircle } from "lucide-react";

interface DriverCPCStatus {
  id: number;
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
  cpcStatus: 'FORMÉ' | 'À FORMER' | 'NON FORMÉ';
  cpcTrainingDate: string | null;
  expiryDate: string | null;
  daysRemaining: number;
  isActive: boolean;
}

export function CPCAlertsPanel() {
  const { data: alerts, isLoading } = useQuery<DriverCPCStatus[]>({
    queryKey: ["/api/drivers/expiring-cpc"],
  });

  if (isLoading) {
    return (
      <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
        <Skeleton className="h-6 w-48 rounded-xl" />
        <div className="space-y-2.5">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3 flex flex-col justify-between" data-testid="panel-cpc-alerts">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-bold text-foreground">Échéances &amp; Formations à Renouveler</span>
          </div>
          {alerts && alerts.length > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/25">
              {alerts.length} alerte(s)
            </span>
          )}
        </div>

        {alerts && alerts.length > 0 ? (
          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
            {alerts.map((driver) => {
              const isExpired = driver.daysRemaining < 0;
              const isUrgent = driver.daysRemaining <= 30;

              return (
                <div
                  key={driver.id}
                  className={`p-3.5 rounded-2xl border transition-all ${
                    isExpired
                      ? "bg-rose-50/70 dark:bg-rose-950/30 border-rose-200/60 text-rose-950 dark:text-rose-100"
                      : isUrgent
                      ? "bg-amber-50/70 dark:bg-amber-950/30 border-amber-200/60 text-amber-950 dark:text-amber-100"
                      : "bg-slate-50 dark:bg-slate-800/50 border-slate-200/60 text-foreground"
                  }`}
                  data-testid={`alert-driver-${driver.id}`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {isExpired ? (
                          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                        ) : (
                          <Clock className="h-4 w-4 text-amber-600 shrink-0" />
                        )}
                        <p className="font-bold text-xs">
                          {driver.firstName} {driver.lastName}
                        </p>
                      </div>
                      {driver.employeeNumber && (
                        <p className="text-[11px] text-muted-foreground">
                          Matricule : {driver.employeeNumber}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground pt-0.5">
                        {driver.cpcTrainingDate && (
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-slate-400" />
                            Session : {formatDate(driver.cpcTrainingDate)}
                          </span>
                        )}
                        {driver.expiryDate && (
                          <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                            Échéance : {formatDate(driver.expiryDate)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isExpired
                            ? "bg-rose-600 text-white"
                            : isUrgent
                            ? "bg-amber-600 text-white"
                            : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                        }`}
                      >
                        {isExpired
                          ? "Expiré"
                          : driver.daysRemaining === 0
                          ? "Aujourd'hui"
                          : `${driver.daysRemaining} j`}
                      </span>
                      <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                        {isExpired
                          ? `Dépassé de ${Math.abs(driver.daysRemaining)} j`
                          : `${driver.daysRemaining} j restants`}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-6 px-4 text-center rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/50 space-y-2">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 mx-auto flex items-center justify-center">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
                Tous les chauffeurs sont à jour !
              </p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Aucune formation CPC à renouveler dans les 30 prochains jours. Le parc de conducteurs est en conformité légale.
              </p>
            </div>
          </div>
        )}
      </div>

      {alerts && alerts.length > 0 && (
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-muted-foreground">
          <span>{alerts.length} chauffeur(s) nécessitant un recyclage</span>
          <div className="flex gap-2 font-bold text-[11px]">
            <span className="text-rose-600">Expirés : {alerts.filter((a) => a.daysRemaining < 0).length}</span>
            <span className="text-amber-600">Urgents : {alerts.filter((a) => a.daysRemaining >= 0 && a.daysRemaining <= 30).length}</span>
          </div>
        </div>
      )}
    </div>
  );
}
