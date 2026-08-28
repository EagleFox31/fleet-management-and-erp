import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/utils";
import { UserCheck, AlertTriangle } from "lucide-react";

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
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const getBadgeVariant = (days: number) => {
    if (days < 0) return "destructive";
    if (days <= 30) return "destructive";
    return "warning";
  };

  const getPriorityIcon = (days: number) => {
    if (days < 0) return "🔴";
    if (days <= 30) return "🟠";
    return "🟡";
  };

  return (
    <Card data-testid="panel-cpc-alerts">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-orange-600" />
          ⚠️ Formations CPC à Renouveler
        </CardTitle>
      </CardHeader>
      <CardContent>
        {alerts && alerts.length > 0 ? (
          <div className="space-y-3">
            {alerts.map((driver) => (
              <div
                key={driver.id}
                className={`p-4 rounded-lg border ${
                  driver.daysRemaining < 0
                    ? "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800"
                    : driver.daysRemaining <= 30
                      ? "bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800"
                      : "bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800"
                }`}
                data-testid={`alert-driver-${driver.id}`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{getPriorityIcon(driver.daysRemaining)}</span>
                      <p className="font-semibold">
                        {driver.firstName} {driver.lastName}
                      </p>
                    </div>
                    {driver.employeeNumber && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                        N° Employé: {driver.employeeNumber}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 text-sm">
                      {driver.cpcTrainingDate && (
                        <span className="text-gray-600 dark:text-gray-400">
                          📅 Formation: {formatDate(driver.cpcTrainingDate)}
                        </span>
                      )}
                      {driver.expiryDate && (
                        <span className="text-gray-600 dark:text-gray-400">
                          📆 Expire: {formatDate(driver.expiryDate)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right ml-4">
                    <Badge variant={getBadgeVariant(driver.daysRemaining)}>
                      {driver.daysRemaining < 0
                        ? "EXPIRÉ"
                        : driver.daysRemaining === 0
                          ? "AUJOURD'HUI"
                          : `${driver.daysRemaining}j`}
                    </Badge>
                    <p className="text-xs text-gray-500 mt-1">
                      {driver.daysRemaining < 0
                        ? `Expiré depuis ${Math.abs(driver.daysRemaining)}j`
                        : `${driver.daysRemaining} jours restants`}
                    </p>
                  </div>
                </div>
                
                {driver.daysRemaining < 0 && (
                  <div className="mt-3 pt-3 border-t border-red-200 dark:border-red-800">
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                      ⚠️ Formation expirée - Action urgente requise
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <UserCheck className="w-12 h-12 text-green-600 mx-auto mb-3" />
            <p className="text-lg font-semibold text-green-600 dark:text-green-400 mb-1">
              ✅ Tous les chauffeurs sont à jour !
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Aucune formation CPC à renouveler pour le moment
            </p>
          </div>
        )}
        
        {alerts && alerts.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">
                Total: <span className="font-semibold">{alerts.length}</span> formation(s) à renouveler
              </span>
              <div className="flex gap-2">
                <span className="text-xs">
                  🔴 Expirés: {alerts.filter(a => a.daysRemaining < 0).length}
                </span>
                <span className="text-xs">
                  🟠 Urgents: {alerts.filter(a => a.daysRemaining >= 0 && a.daysRemaining <= 30).length}
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
