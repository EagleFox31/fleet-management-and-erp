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
import { ClipboardList, Users, MapPin, FileText } from "lucide-react";
import { statusWhenHigherIsBetter, statusWhenLowerIsBetter } from "@/lib/kpi-status";
import { HeaderCard, KpiGrid, KpiTile } from "@/components/design-system";

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

  const clientsData = statsByClient.data || [];
  const totalRevenue = clientsData.reduce((sum, client) => sum + (client.totalRevenue || 0), 0);
  const totalCost = clientsData.reduce((sum, client) => sum + (client.totalCost || 0), 0);
  const totalMissions = clientsData.reduce((sum, client) => sum + (client.totalMissions || 0), 0);
  const margin = totalRevenue - totalCost;
  const marginPercentage = totalRevenue > 0 ? (margin / totalRevenue * 100) : 0;
  const activeMissionsCount = Array.isArray(activeMissions.data) ? activeMissions.data.length : 0;
  const activeClientNames = clientsData
    .map((client: any) => client.clientName)
    .filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 0);
  const activeClientsCount = activeClientNames.length;
  const clientsSubValue =
    activeClientsCount === 0
      ? "Aucun client actif"
      : `${activeClientNames.slice(0, 4).join(", ")}${activeClientNames.length > 4 ? ` +${activeClientNames.length - 4}` : ""}`;

  // Une erreur sur les missions actives ne vaut pas « 0 en cours » : pas de statut coloré.
  const missionsStatus = activeMissions.isError
    ? undefined
    : statusWhenLowerIsBetter(activeMissionsCount, {
        warningAbove: 0,
        criticalAbove: 5,
      });
  const revenueStatus = statusWhenHigherIsBetter(totalRevenue, {
    warningBelow: 1,
    criticalBelow: 0,
  });
  const marginStatus =
    totalRevenue <= 0
      ? "neutral"
      : statusWhenHigherIsBetter(marginPercentage, {
          warningBelow: 15,
          criticalBelow: 5,
        });
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
        {statsByClient.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <Skeleton className="h-[92px] w-full rounded-xl" />
            <Skeleton className="h-[92px] w-full rounded-xl" />
            <Skeleton className="h-[92px] w-full rounded-xl" />
            <Skeleton className="h-[92px] w-full rounded-xl" />
          </div>
        ) : statsByClient.isError ? (
          <p className="text-sm text-muted-foreground" data-testid="kpi-unavailable">
            Indicateurs momentanément indisponibles.
          </p>
        ) : (
          <KpiGrid columns={4}>
            <KpiTile
              label="Missions actives"
              featured // le pouls de l'exploitation
              value={formatNumber(totalMissions)}
              subValue={activeMissions.isError ? "En cours : indisponible" : `${activeMissionsCount} en cours`}
              icon={<ClipboardList className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
              valueClassName={missionsStatus === "critical" ? "text-red-600" : missionsStatus === "warning" ? "text-amber-600" : undefined}
              data-testid="kpi-total-missions"
            />
            <KpiTile
              label="Chiffre d'affaires"
              value={formatPrice(totalRevenue)}
              subValue="Facture clients"
              icon={<FileText className="h-4 w-4" />}
              iconWrapperClassName="bg-green-50 text-green-600"
              valueClassName={revenueStatus === "critical" ? "text-red-600" : revenueStatus === "warning" ? "text-amber-600" : "text-green-700"}
              data-testid="kpi-revenue"
            />
            <KpiTile
              label="Marge brute"
              value={`${marginPercentage.toFixed(1)}%`}
              subValue={formatPrice(margin)}
              icon={<MapPin className="h-4 w-4" />}
              iconWrapperClassName="bg-indigo-50 text-indigo-600"
              valueClassName={marginStatus === "critical" ? "text-red-600" : marginStatus === "warning" ? "text-amber-600" : undefined}
              data-testid="kpi-margin"
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
