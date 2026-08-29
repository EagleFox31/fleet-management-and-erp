import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { HeaderCard } from "@/components/design-system";
import { ManagementPeriodSelector } from "@/components/management/management-period-selector";
import { ManagementTeamBento } from "@/components/management/management-team-bento";
import type { ManagementPeriod } from "@shared/constants/management-dashboard";
import type {
  ManagementTeamPoleId,
  ManagementTeamResponse,
} from "@shared/constants/management-team";

export default function ManagementTeamPage() {
  const [period, setPeriod] = useState<ManagementPeriod>("month");
  const [selectedPoleId, setSelectedPoleId] = useState<ManagementTeamPoleId | null>(null);

  const { data, isLoading, isFetching } = useQuery<ManagementTeamResponse>({
    queryKey: ["/api/management/team", { period }],
    queryFn: async () => {
      const response = await fetch(`/api/management/team?period=${period}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Impossible de charger la vue équipe");
      }
      return response.json();
    },
    staleTime: 30_000,
  });

  const togglePole = (poleId: ManagementTeamPoleId) => {
    setSelectedPoleId((current) => (current === poleId ? null : poleId));
  };

  return (
    <div className="space-y-6">
      {/* Header Card avec Pastilles de Période (7 jours, Ce mois, Trimestre, Cette année) alignées à droite sur la même ligne */}
      <HeaderCard
        moduleLabel="Direction · Capital Humain"
        title="Mon équipe"
        subtitle="Pilotage stratégique des effectifs, conformité légale, rendement par pôle et palmarès des primes"
        icon={<Users className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            {isFetching && !isLoading && (
              <Loader2 className="h-4 w-4 animate-spin text-emerald-600 mr-1" />
            )}
            <ManagementPeriodSelector value={period} onChange={setPeriod} />
          </div>
        }
      />

      {/* Loader de Page Bento Structuré */}
      {isLoading || !data ? (
        <div className="space-y-4">
          {/* Skeleton Bandeau Mobilisation */}
          <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full md:w-auto">
              <Skeleton className="h-10 w-10 rounded-2xl" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto justify-end">
              <Skeleton className="h-8 w-24 rounded-full" />
              <Skeleton className="h-8 w-28 rounded-full" />
            </div>
          </div>

          {/* Skeleton Grille des 4 Pôles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <Skeleton className="h-36 w-full rounded-3xl" />
            <Skeleton className="h-36 w-full rounded-3xl" />
            <Skeleton className="h-36 w-full rounded-3xl" />
            <Skeleton className="h-36 w-full rounded-3xl" />
          </div>

          {/* Skeleton Radar & Palmarès */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-72 w-full rounded-3xl" />
            <Skeleton className="h-72 w-full rounded-3xl" />
          </div>
        </div>
      ) : (
        <ManagementTeamBento
          data={data}
          selectedPoleId={selectedPoleId}
          onSelectPole={togglePole}
        />
      )}
    </div>
  );
}
