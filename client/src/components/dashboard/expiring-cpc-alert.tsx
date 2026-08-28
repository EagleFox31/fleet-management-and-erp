import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { GraduationCap, ChevronRight, User } from "lucide-react";

interface ExpiringCPC {
  id: number;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  cpcStatus: string;
  cpcTrainingDate: string | null;
  expiryDate: string | null;
  daysRemaining: number;
  isActive: boolean;
}

function getSeverityBadge(days: number) {
  if (days < 0) return <Badge variant="destructive" className="text-xs">Expiré</Badge>;
  if (days <= 30) return <Badge variant="destructive" className="text-xs">{days}j restants</Badge>;
  if (days <= 90) return <Badge className="bg-orange-500 text-white text-xs">{days}j restants</Badge>;
  return <Badge className="bg-amber-500 text-white text-xs">{days}j restants</Badge>;
}

export function ExpiringCPCAlert() {
  const [, setLocation] = useLocation();

  const { data: drivers = [], isLoading } = useQuery<ExpiringCPC[]>({
    queryKey: ["/api/drivers/expiring-cpc"],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">CPC Chauffeurs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-16">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (drivers.length === 0) {
    return (
      <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20 dark:border-green-900">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-green-600" />
            <CardTitle className="text-base">CPC Chauffeurs</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-green-600 dark:text-green-400 font-medium">Toutes les certifications sont valides ✓</p>
        </CardContent>
      </Card>
    );
  }

  const expiredCount = drivers.filter(d => d.daysRemaining < 0).length;
  const urgentCount = drivers.filter(d => d.daysRemaining >= 0 && d.daysRemaining <= 30).length;
  const top = [...drivers].sort((a, b) => a.daysRemaining - b.daysRemaining).slice(0, 4);

  return (
    <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-900">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <CardTitle className="text-base">CPC Chauffeurs</CardTitle>
          </div>
          <div className="flex gap-1">
            {expiredCount > 0 && (
              <Badge variant="destructive" className="text-xs">{expiredCount} expiré{expiredCount > 1 ? 's' : ''}</Badge>
            )}
            {urgentCount > 0 && (
              <Badge className="bg-orange-500 text-white text-xs">{urgentCount} urgent{urgentCount > 1 ? 's' : ''}</Badge>
            )}
            <Badge className="bg-blue-500 text-white text-xs">{drivers.length} à former</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {top.map((driver) => (
          <div key={driver.id} className="flex items-center justify-between bg-card border rounded px-2.5 py-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium truncate">
                {driver.firstName} {driver.lastName}
              </span>
              {driver.employeeNumber && (
                <span className="text-xs text-muted-foreground shrink-0">#{driver.employeeNumber}</span>
              )}
            </div>
            {getSeverityBadge(driver.daysRemaining)}
          </div>
        ))}

        {drivers.length > 4 && (
          <p className="text-xs text-muted-foreground pl-1">+{drivers.length - 4} autre{drivers.length - 4 > 1 ? 's' : ''}...</p>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full border-blue-300 hover:bg-blue-100 dark:border-blue-800 dark:hover:bg-blue-950/40 mt-1"
          onClick={() => setLocation('/fleet/drivers')}
        >
          Gérer les formations CPC
          <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </CardContent>
    </Card>
  );
}
