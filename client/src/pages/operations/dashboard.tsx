import { useOperations } from "@/hooks/useOperations";
import { formatPrice, formatNumber } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClientsPanel } from "@/components/operations/clients-panel";
import { DestinationsChart } from "@/components/operations/destinations-chart";
import { MissionsList } from "@/components/operations/missions-list";
import { InvoicingDashboard } from "@/components/operations/invoicing-dashboard";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ClipboardList, Users, MapPin, FileText, Fuel } from "lucide-react";
import { statusWhenHigherIsBetter, statusWhenLowerIsBetter } from "@/lib/kpi-status";
import { HeaderCard, KpiGrid, KpiTile } from "@/components/design-system";
import { InlineQueryError } from "@/components/ui/inline-query-error";
import { listQueryView, readyData } from "@/lib/query-view";
import { clientTotals, LOADING_VALUE, statDisplay } from "@/lib/secretary-dashboard-stats";
import type { ClientSummary } from "@/services/operationsService";

export default function OperationsDashboard() {
  const { statsByClient, statsByDestination, upcomingMissions, activeMissions } = useOperations();
  const [location, setLocation] = useLocation();

  type OperationsTab = "missions" | "clients" | "destinations" | "invoices";
  const allowedTabs: OperationsTab[] = ["missions", "clients", "destinations", "invoices"];

  const resolveTabFromLocation = (value: string): OperationsTab => {
    const query = value.includes("?") ? value.split("?")[1] ?? "" : "";
    const tab = new URLSearchParams(query).get("tab");
    if (tab && allowedTabs.includes(tab as OperationsTab)) {
      return tab as OperationsTab;
    }
    return "missions";
  };

  const [activeTab, setActiveTab] = useState<OperationsTab>(() => resolveTabFromLocation(location));

  useEffect(() => {
    const tabFromUrl = resolveTabFromLocation(location);
    setActiveTab((prev) => (prev === tabFromUrl ? prev : tabFromUrl));
  }, [location]);

  // `estimatedFuelCost` (ex-`totalRevenue`) est un carburant estimé, pas un chiffre d'affaires :
  // ni CA ni marge n'en sont tirés. Un chiffre illisible vaut « Indisponible », jamais 0.
  const statsView = listQueryView<ClientSummary>(statsByClient);
  const clientsList = readyData(statsView, null);
  const totals = clientTotals(clientsList);
  // Q19 : le carburant estimé est masqué (null) hors lecteurs du budget ; la tuile disparaît.
  const fuelEstimateRedacted =
    clientsList !== null && clientsList.length > 0 && clientsList.every((client) => client.estimatedFuelCost === null);
  const activeMissionsView = listQueryView<unknown>(activeMissions);
  const activeMissionsCount = activeMissionsView.kind === "ready" ? activeMissionsView.data.length : null;
  const activeClientNames = (clientsList ?? [])
    .map((client) => client.clientName)
    .filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 0);
  const activeClientsCount = activeClientNames.length;
  const clientsSubValue =
    activeClientsCount === 0
      ? "Aucun client actif"
      : `${activeClientNames.slice(0, 4).join(", ")}${activeClientNames.length > 4 ? ` +${activeClientNames.length - 4}` : ""}`;

  // Missions actives inconnues : pas « 0 en cours », pas de statut coloré.
  const missionsStatus =
    activeMissionsCount === null
      ? undefined
      : statusWhenLowerIsBetter(activeMissionsCount, {
          warningAbove: 0,
          criticalAbove: 5,
        });
  const missionsSubValue =
    activeMissionsView.kind === "ready"
      ? `${activeMissionsCount} en cours`
      : activeMissionsView.kind === "loading"
        ? `En cours : ${LOADING_VALUE}`
        : "En cours : indisponible";
  const clientsStatus = statusWhenHigherIsBetter(activeClientsCount, {
    warningBelow: 1,
    criticalBelow: 0,
  });

  const handleTabChange = (nextTab: string) => {
    const tab = (allowedTabs.includes(nextTab as OperationsTab) ? nextTab : "missions") as OperationsTab;
    setActiveTab(tab);
    const target = tab === "missions" ? "/operations" : `/operations?tab=${tab}`;
    if (location !== target) {
      setLocation(target);
    }
  };

  const operationsTabTriggerClass =
    "flex-1 min-w-[130px] flex items-center justify-center gap-1.5 px-3 py-2 text-[13px] rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-green-700 transition-all";

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Operations"
        title="Dashboard operations"
        data-testid="page-header-operations"
        subtitle="Gestion des missions clients et facturation"
        icon={<ClipboardList className="h-5 w-5" />}
      >
        {statsView.kind === "loading" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <Skeleton className="h-[92px] w-full rounded-xl" />
            <Skeleton className="h-[92px] w-full rounded-xl" />
            <Skeleton className="h-[92px] w-full rounded-xl" />
            <Skeleton className="h-[92px] w-full rounded-xl" />
          </div>
        ) : statsView.kind === "error" ? (
          <InlineQueryError
            error={statsView.error}
            fallback="Indicateurs momentanément indisponibles."
            onRetry={() => statsByClient.refetch()}
            isRetrying={statsView.isRetrying}
            data-testid="kpi-unavailable"
          />
        ) : (
          <KpiGrid columns={4}>
            <KpiTile
              label="Missions actives"
              featured // le pouls de l'exploitation
              value={statDisplay(statsView, totals.missions, formatNumber)}
              subValue={missionsSubValue}
              icon={<ClipboardList className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
              valueClassName={missionsStatus === "critical" ? "text-red-600" : missionsStatus === "warning" ? "text-amber-600" : undefined}
              data-testid="kpi-total-missions"
            />
            {!fuelEstimateRedacted && (
              <KpiTile
                label="Carburant estimé (missions)"
                value={statDisplay(statsView, totals.estimatedFuelCost, formatPrice)}
                subValue="Somme des estimations des missions"
                icon={<Fuel className="h-4 w-4" />}
                data-testid="kpi-fuel-estimated"
              />
            )}
            <KpiTile
              label="Carburant réel (missions)"
              value={statDisplay(statsView, totals.fuelCost, formatPrice)}
              subValue="Pleins rattachés aux missions"
              icon={<Fuel className="h-4 w-4" />}
              data-testid="kpi-fuel-actual"
            />
            <KpiTile
              label="Clients actifs"
              value={formatNumber(activeClientsCount)}
              subValue={clientsSubValue}
              icon={<Users className="h-4 w-4" />}
              iconWrapperClassName="bg-orange-50 text-orange-600"
              valueClassName={clientsStatus === "critical" ? "text-red-600" : clientsStatus === "warning" ? "text-amber-600" : undefined}
              data-testid="kpi-clients"
            />
          </KpiGrid>
        )}
      </HeaderCard>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="mb-6">
        <TabsList className="w-full rounded-xl bg-gray-100/70 p-1 h-auto gap-1 flex flex-wrap">
          <TabsTrigger value="missions" data-testid="tab-missions" className={operationsTabTriggerClass}>
            <span className="inline-flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              Missions
            </span>
          </TabsTrigger>
          <TabsTrigger value="clients" data-testid="tab-clients" className={operationsTabTriggerClass}>
            <span className="inline-flex items-center gap-2">
              <Users className="h-4 w-4" />
              Clients
            </span>
          </TabsTrigger>
          <TabsTrigger value="destinations" data-testid="tab-destinations" className={operationsTabTriggerClass}>
            <span className="inline-flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Destinations
            </span>
          </TabsTrigger>
          <TabsTrigger value="invoices" data-testid="tab-invoices" className={operationsTabTriggerClass}>
            <span className="inline-flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Factures clients
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="missions">
          <MissionsList />
        </TabsContent>

        <TabsContent value="clients">
          <ClientsPanel />
        </TabsContent>

        <TabsContent value="destinations">
          <DestinationsChart
            data={statsByDestination.data}
            error={statsByDestination.error}
            isFetching={statsByDestination.isFetching}
            onRetry={() => statsByDestination.refetch()}
          />
        </TabsContent>

        <TabsContent value="invoices">
          <InvoicingDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
