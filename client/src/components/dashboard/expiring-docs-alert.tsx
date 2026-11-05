import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { FileWarning, ChevronRight, Shield, Car, Wrench } from "lucide-react";

interface ExpiringDocsData {
  carteGrise: any[];
  assurance: any[];
  visiteTechnique: any[];
  totalExpiring: number;
}

interface DocumentStats {
  expiringCarteGrise: number;
  expiredCarteGrise: number;
  expiringAssurance: number;
  expiredAssurance: number;
  expiringVisiteTechnique: number;
  expiredVisiteTechnique: number;
}

const DOC_TYPES = [
  { key: 'assurance', label: 'Assurance', icon: Shield, color: 'text-red-500', dateField: 'insuranceExpiry' },
  { key: 'visiteTechnique', label: 'Visite technique', icon: Wrench, color: 'text-orange-500', dateField: 'technicalInspectionDate' },
  { key: 'carteGrise', label: 'Carte grise', icon: Car, color: 'text-yellow-500', dateField: 'licensePlateExpiry' },
];

function getDaysUntil(dateStr: string): number {
  if (!dateStr) return 0;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getSeverityBadge(days: number) {
  if (days < 0) return <Badge variant="destructive" className="text-xs">Expiré</Badge>;
  if (days <= 7) return <Badge variant="destructive" className="text-xs">{days}j</Badge>;
  if (days <= 30) return <Badge className="bg-orange-500 text-white text-xs">{days}j</Badge>;
  return <Badge className="bg-amber-500 text-white text-xs">{days}j</Badge>;
}

export function ExpiringDocsAlert() {
  const [, setLocation] = useLocation();

  const { data: expiringData, isLoading: expiringLoading } = useQuery<ExpiringDocsData>({
    queryKey: ["/api/vehicles/expiring-docs", { days: 30 }],
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<DocumentStats>({
    queryKey: ["/api/vehicles/document-stats"],
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  const expiringCount =
    Number(
      stats
        ? (stats.expiringCarteGrise || 0) +
            (stats.expiringAssurance || 0) +
            (stats.expiringVisiteTechnique || 0)
        : expiringData?.totalExpiring || 0,
    );

  const expiredCount = Number(
    (stats?.expiredCarteGrise || 0) +
      (stats?.expiredAssurance || 0) +
      (stats?.expiredVisiteTechnique || 0),
  );

  const totalToHandle = expiringCount + expiredCount;
  const data = expiringData ?? {
    carteGrise: [],
    assurance: [],
    visiteTechnique: [],
    totalExpiring: 0,
  };

  const hasExpiringItems = DOC_TYPES.some(({ key }) => ((data as any)?.[key] || []).length > 0);

  if (expiringLoading || statsLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Documents véhicules</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-16">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (totalToHandle === 0) {
    return (
      <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20 dark:border-green-900">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <FileWarning className="h-5 w-5 text-green-600" />
            <CardTitle className="text-base">Documents véhicules</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-green-600 dark:text-green-400 font-medium">Tous les documents sont à jour</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={
        expiredCount > 0
          ? "border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900"
          : "border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900"
      }
    >
      <CardHeader className="pb-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <FileWarning
              className={
                expiredCount > 0
                  ? "h-5 w-5 text-red-600 dark:text-red-500"
                  : "h-5 w-5 text-amber-600 dark:text-amber-500"
              }
            />
            <CardTitle className="text-base">Documents véhicules</CardTitle>
          </div>
          <div className="flex gap-1">
            {expiredCount > 0 && (
              <Badge variant="destructive" className="text-xs">{expiredCount} expiré{expiredCount > 1 ? 's' : ''}</Badge>
            )}
            {expiringCount > 0 && (
              <Badge className="bg-amber-500 text-white text-xs">{expiringCount} à renouveler</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {expiredCount > 0 && (
          <p className="text-xs font-medium text-red-700 dark:text-red-300">
            {expiredCount} document(s) déjà expiré(s) nécessitent une action immédiate.
          </p>
        )}

        {DOC_TYPES.map(({ key, label, icon: Icon, color, dateField }) => {
          const items = (data as any)?.[key] || [];
          if (items.length === 0) return null;
          const top = items.slice(0, 2);
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center gap-1 mb-1">
                <Icon className={`h-3.5 w-3.5 ${color}`} />
                <span className="text-xs font-medium text-muted-foreground">{label} ({items.length})</span>
              </div>
              {top.map((v: any) => {
                const days = getDaysUntil(v[dateField]);
                return (
                  <div key={v.id} className="flex items-center justify-between bg-card border rounded px-2.5 py-1.5">
                    <span className="text-xs font-medium truncate">{v.registrationNumber || v.registration}</span>
                    {getSeverityBadge(days)}
                  </div>
                );
              })}
              {items.length > 2 && (
                <p className="text-xs text-muted-foreground pl-1">+{items.length - 2} autre{items.length - 2 > 1 ? 's' : ''}...</p>
              )}
            </div>
          );
        })}

        {!hasExpiringItems && expiredCount > 0 && (
          <p className="text-xs text-muted-foreground">
            Aucun document “expirant bientôt”, mais des documents sont déjà expirés.
          </p>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full border-amber-300 hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-950/40"
          onClick={() => setLocation('/fleet/vehicles')}
        >
          Voir tous les documents
          <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </CardContent>
    </Card>
  );
}
