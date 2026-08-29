import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, FileText, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CardShell, HeaderCard, SectionLabel } from "@/components/design-system";
import { ManagementPeriodSelector } from "@/components/management/management-period-selector";
import { ManagementTrendBadge } from "@/components/management/management-trend-badge";
import { exportManagementBoardPackPdf } from "@/lib/management-board-pack-pdf";
import { formatPrice } from "@/lib/utils";
import type { ManagementDashboardResponse, ManagementPeriod } from "@shared/constants/management-dashboard";

export default function ManagementReportsPage() {
  const [period, setPeriod] = useState<ManagementPeriod>("month");

  const { data, isLoading } = useQuery<ManagementDashboardResponse>({
    queryKey: ["/api/management/dashboard", { period }],
    queryFn: async () => {
      const response = await fetch(`/api/management/dashboard?period=${period}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Impossible de charger les rapports Direction");
      }
      return response.json();
    },
  });

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Direction · Rapports"
        title="Rapport mensuel Direction"
        subtitle="Export PDF synthétique pour le comité de direction — lecture seule"
        icon={<FileText className="h-5 w-5" />}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ManagementPeriodSelector value={period} onChange={setPeriod} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Retour au tableau de bord
              </Link>
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!data}
              onClick={() => data && exportManagementBoardPackPdf(data)}
            >
              <Download className="mr-2 h-4 w-4" />
              Télécharger le PDF
            </Button>
          </div>
        </div>
      </HeaderCard>

      {isLoading || !data ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <CardShell>
          <div className="px-5 py-5 space-y-5">
            <div>
              <SectionLabel>Contenu du rapport</SectionLabel>
              <p className="mt-2 text-sm text-muted-foreground">
                Période {data.periodStart} → {data.periodEnd}. Le PDF inclut la synthèse
                financière, les tendances vs {data.trends.previousPeriodLabel.toLowerCase()},
                le détail des charges, la flotte, les tops clients, marchandises et destinations.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-4 space-y-2">
                <p className="text-sm font-semibold text-gray-900">CA facturé (TTC)</p>
                <p className="text-xl font-bold text-emerald-700">{formatPrice(data.revenue.invoicedTTC)}</p>
                <ManagementTrendBadge percent={data.trends.revenueTTC} />
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-4 space-y-2">
                <p className="text-sm font-semibold text-gray-900">Résultat brut (HT)</p>
                <p className={`text-xl font-bold ${data.result.grossHT >= 0 ? "text-blue-700" : "text-red-600"}`}>
                  {formatPrice(data.result.grossHT)}
                </p>
                <ManagementTrendBadge percent={data.trends.grossHT} />
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LayoutDashboard className="h-4 w-4" />
              Les chiffres proviennent du même agrégateur que le tableau de bord Direction.
            </div>
          </div>
        </CardShell>
      )}
    </div>
  );
}
