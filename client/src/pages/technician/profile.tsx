import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { User, Clock, Wrench, Euro, TrendingUp, Calendar, CheckCircle, Package, Activity, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { formatPrice, cn } from "@/lib/utils";
import { HeaderCard, KpiGrid, KpiTile, CardShell, PremiumTabsNav, SectionLabel } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { technicianProfileStats, technicianProfileView, type TechnicianProfileWorkOrder } from "@/lib/technician-profile-stats";
import { formatKnownCost } from "@/lib/work-order-tires-cost";
import { InlineQueryError } from "@/components/ui/inline-query-error";
import { UNAVAILABLE } from "@/components/dashboard/kpi-tiles";

export default function TechnicianProfilePage() {
  const { user } = useAuth();

  const technicianQuery = useQuery<unknown>({
    queryKey: ['/api/technician/my-work-orders'],
  });
  // Échec sans données : « Indisponible » et « Réessayer », jamais des coûts à 0.
  const profileView = technicianProfileView(technicianQuery);
  const profile = profileView.kind === "ready" ? profileView.data : technicianProfileStats([]);

  const myWorkOrders: TechnicianProfileWorkOrder[] = profile.workOrders;
  const completedOrders: TechnicianProfileWorkOrder[] = profile.completed;
  const inProgressOrders = profile.inProgress;
  const pendingOrders = profile.pending;
  const { totalCost, averageCost, partsCost, tiresCost, maintenanceCost } = profile;
  // Un total inconnu (un OT terminé sans coût) s'affiche « Indisponible », jamais une somme partielle.
  const money = (value: number | null) => formatKnownCost(value, formatPrice, { isError: true });
  const shareOf = (value: number | null): number | null =>
    value === null || totalCost === null ? null : totalCost > 0 ? (value / totalCost) * 100 : 0;
  const shareLabel = (value: number | null) => {
    const share = shareOf(value);
    return share === null ? UNAVAILABLE : `${share.toFixed(1)}% du total`;
  };
  const workloadPercentage = Math.min(100, (inProgressOrders.length + pendingOrders.length) * 20);

  const recentActions = [...myWorkOrders]
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .slice(0, 5);

  const thisMonth = new Date();
  thisMonth.setDate(1);
  const thisMonthOrders = completedOrders.filter((wo) => {
    const completionDate = wo.endDate ? new Date(wo.endDate) : new Date(wo.updatedAt ?? 0);
    return completionDate >= thisMonth;
  });

  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  lastMonth.setDate(1);
  const lastMonthOrders = completedOrders.filter((wo) => {
    const completionDate = wo.endDate ? new Date(wo.endDate) : new Date(wo.updatedAt ?? 0);
    return completionDate >= lastMonth && completionDate < thisMonth;
  });

  const monthlyGrowth = lastMonthOrders.length > 0
    ? ((thisMonthOrders.length - lastMonthOrders.length) / lastMonthOrders.length) * 100
    : 0;

  const completionRate = myWorkOrders.length > 0
    ? ((completedOrders.length / myWorkOrders.length) * 100).toFixed(1)
    : "0";

  const tabItems = [
    {
      value: "overview",
      label: "Vue d'ensemble",
      icon: <TabIcon icon={User} />,
    },
    {
      value: "performance",
      label: "Performance",
      icon: <TabIcon icon={TrendingUp} />,
    },
    {
      value: "costs",
      label: "Coûts & Budget",
      icon: <TabIcon icon={Euro} />,
    },
    {
      value: "activity",
      label: "Activité",
      icon: <TabIcon icon={Activity} />,
    },
  ];

  if (profileView.kind === "error") {
    return (
      <div className="space-y-5">
        <HeaderCard
          moduleLabel="Technicien · Profil"
          title={user?.name || "Mon Profil"}
          subtitle={user?.email || "Informations personnelles et performances"}
          icon={<User className="h-5 w-5" />}
        >
          <KpiGrid columns={4}>
            {["Total OT assignés", "Terminés", "Ce mois", "Coût moyen / OT"].map((label) => (
              <KpiTile
                key={label}
                label={label}
                value={UNAVAILABLE}
                icon={<Activity className="h-4 w-4" />}
                iconWrapperClassName="bg-gray-100 text-gray-400"
              />
            ))}
          </KpiGrid>
        </HeaderCard>
        <InlineQueryError
          error={profileView.error}
          fallback="Vos ordres de travail et leurs coûts sont momentanément indisponibles."
          onRetry={() => void technicianQuery.refetch()}
          isRetrying={profileView.isRetrying}
          data-testid="technician-profile-error"
        />
      </div>
    );
  }

  if (profileView.kind === "loading") {
    return (
      <div className="space-y-5">
        <CardShell topBar>
          <div className="px-6 py-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-xl" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-3 w-64" />
                </div>
              </div>
              <Skeleton className="h-7 w-24 rounded-full" />
            </div>
            <div className="mt-5 pt-5 border-t border-gray-100 grid grid-cols-1 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={`tech-profile-header-kpi-skeleton-${i}`} className="h-24 w-full rounded-xl" />
              ))}
            </div>
          </div>
        </CardShell>

        <Skeleton className="h-12 w-full rounded-2xl" />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <CardShell key={`tech-profile-body-skeleton-${i}`}>
              <div className="p-5 space-y-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-4/5 rounded-lg" />
              </div>
            </CardShell>
          ))}
        </div>
      </div>
    );
  }

  const statusChip = (status: string) => {
    switch (status) {
      case 'completed':  return <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-green-100 text-green-700">Terminé</span>;
      case 'in_progress': return <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-700">En cours</span>;
      default:            return <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700">En attente</span>;
    }
  };

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Technicien · Profil"
        title={user?.name || "Mon Profil"}
        subtitle={user?.email || "Informations personnelles et performances"}
        icon={<User className="h-5 w-5" />}
        actions={
          <span className="inline-flex items-center rounded-full bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs font-semibold text-blue-700">
            Technicien
          </span>
        }
      >
        <KpiGrid columns={4}>
          <KpiTile
            label="Total OT assignés"
            value={myWorkOrders.length}
            subValue="Ordres de travail"
            icon={<Wrench className="h-4 w-4" />}
            iconWrapperClassName="bg-gray-100 text-gray-600"
          />
          <KpiTile
            label="Terminés"
            value={completedOrders.length}
            subValue={`${completionRate}% de réussite`}
            icon={<CheckCircle className="h-4 w-4" />}
            iconWrapperClassName="bg-green-50 text-green-600"
          />
          <KpiTile
            label="Ce mois"
            value={thisMonthOrders.length}
            subValue={`${monthlyGrowth >= 0 ? '+' : ''}${monthlyGrowth.toFixed(1)}% vs mois dernier`}
            icon={<Calendar className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
          />
          <KpiTile
            label="Coût moyen / OT"
            value={money(averageCost)}
            subValue="Par intervention"
            icon={<Euro className="h-4 w-4" />}
            iconWrapperClassName="bg-purple-50 text-purple-600"
          />
        </KpiGrid>
      </HeaderCard>

      <Tabs defaultValue="overview">
        <PremiumTabsNav tabs={tabItems} />

        {/* Vue d'ensemble */}
        <TabsContent value="overview" className="space-y-4">
          <CardShell topBar>
            <div className="px-5 py-4">
              <SectionLabel className="mb-4 inline-block">Informations personnelles</SectionLabel>
              <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                {[
                  { label: "Nom complet", value: user?.name },
                  { label: "Email", value: user?.email },
                  { label: "Nom d'utilisateur", value: user?.username },
                  { label: "Rôle", value: "Technicien" },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
                    <p className="text-sm font-semibold text-gray-800 mt-0.5">{value || "—"}</p>
                  </div>
                ))}
              </div>
            </div>
          </CardShell>

          <CardShell>
            <div className="px-5 py-4 space-y-4">
              <div>
                <SectionLabel className="mb-1 inline-block">Charge de travail actuelle</SectionLabel>
                <p className="text-xs text-gray-400">Basée sur les ordres de travail assignés</p>
              </div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-gray-600 font-medium">Ordres en cours / attente</span>
                <span className="text-gray-400">{inProgressOrders.length + pendingOrders.length} ordres</span>
              </div>
              <Progress value={workloadPercentage} className="h-2" />
              <p className="text-xs text-center text-gray-400">{workloadPercentage}% de capacité</p>
              <KpiGrid columns={2} withTopBorder={false}>
                <KpiTile
                  label="En cours"
                  value={inProgressOrders.length}
                  valueClassName={inProgressOrders.length > 0 ? "text-blue-700" : undefined}
                  icon={<Wrench className="h-4 w-4" />}
                  iconWrapperClassName="bg-blue-50 text-blue-600"
                />
                <KpiTile
                  label="En attente"
                  value={pendingOrders.length}
                  valueClassName={pendingOrders.length > 0 ? "text-amber-700" : undefined}
                  icon={<Clock className="h-4 w-4" />}
                  iconWrapperClassName="bg-amber-50 text-amber-600"
                />
              </KpiGrid>
            </div>
          </CardShell>
        </TabsContent>

        {/* Performance */}
        <TabsContent value="performance" className="space-y-4">
          <CardShell>
            <div className="px-5 py-4 space-y-4">
              <SectionLabel>Performance mensuelle</SectionLabel>
              <div className="flex items-center justify-between">
                <div className="text-center">
                  <p className="text-2xl font-bold text-gray-800">{lastMonthOrders.length}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Mois dernier</p>
                </div>
                <div className="flex flex-col items-center gap-1">
                  {monthlyGrowth >= 0 ? (
                    <ArrowUpRight className="h-5 w-5 text-green-500" />
                  ) : (
                    <ArrowDownRight className="h-5 w-5 text-red-500" />
                  )}
                  <span className={cn("text-sm font-bold", monthlyGrowth >= 0 ? "text-green-600" : "text-red-600")}>
                    {monthlyGrowth >= 0 ? '+' : ''}{monthlyGrowth.toFixed(1)}%
                  </span>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-gray-800">{thisMonthOrders.length}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Ce mois</p>
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                  <span>Taux de complétion global</span>
                  <span>{completionRate}%</span>
                </div>
                <Progress value={Number(completionRate)} className="h-2" />
              </div>
            </div>
          </CardShell>

          <KpiGrid columns={4} withTopBorder={false}>
            <KpiTile
              label="Total OT"
              value={myWorkOrders.length}
              subValue="Ordres assignés"
              icon={<Wrench className="h-4 w-4" />}
              iconWrapperClassName="bg-gray-100 text-gray-600"
            />
            <KpiTile
              label="Terminés"
              value={completedOrders.length}
              subValue={`${completionRate}% de réussite`}
              icon={<CheckCircle className="h-4 w-4" />}
              iconWrapperClassName="bg-green-50 text-green-600"
            />
            <KpiTile
              label="Ce mois"
              value={thisMonthOrders.length}
              subValue={`${monthlyGrowth >= 0 ? '+' : ''}${monthlyGrowth.toFixed(1)}% vs N-1`}
              icon={<Calendar className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
            />
            <KpiTile
              label="Coût moyen"
              value={money(averageCost)}
              subValue="Par intervention"
              icon={<Euro className="h-4 w-4" />}
              iconWrapperClassName="bg-purple-50 text-purple-600"
            />
          </KpiGrid>
        </TabsContent>

        {/* Coûts & Budget */}
        <TabsContent value="costs" className="space-y-4">
          <KpiGrid columns={4} withTopBorder={false}>
            <KpiTile
              label="Total général"
              value={money(totalCost)}
              subValue="Coût total interventions"
              icon={<Euro className="h-4 w-4" />}
              iconWrapperClassName="bg-gray-100 text-gray-600"
            />
            <KpiTile
              label="Pièces"
              value={money(partsCost)}
              subValue={shareLabel(partsCost)}
              icon={<Package className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
            />
            <KpiTile
              label="Pneus"
              value={money(tiresCost)}
              subValue={shareLabel(tiresCost)}
              icon={<TrendingUp className="h-4 w-4" />}
              iconWrapperClassName="bg-orange-50 text-orange-600"
            />
            <KpiTile
              label="Maintenance"
              value={money(maintenanceCost)}
              subValue={shareLabel(maintenanceCost)}
              icon={<Wrench className="h-4 w-4" />}
              iconWrapperClassName="bg-green-50 text-green-600"
            />
          </KpiGrid>

          <CardShell>
            <div className="px-5 py-4">
              <SectionLabel className="mb-4 inline-block">Répartition des coûts par catégorie</SectionLabel>
              <div className="space-y-5">
                {[
                  { label: "Pièces détachées", icon: Package, iconClass: "text-blue-600", value: partsCost, color: "bg-blue-500" },
                  { label: "Pneumatiques", icon: Package, iconClass: "text-orange-600", value: tiresCost, color: "bg-orange-500" },
                  { label: "Maintenance", icon: Wrench, iconClass: "text-green-600", value: maintenanceCost, color: "bg-green-500" },
                ].map(({ label, icon: Icon, iconClass, value, color }) => (
                  <div key={label} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className={cn("h-4 w-4", iconClass)} />
                        <span className="text-sm text-gray-600">{label}</span>
                      </div>
                      <span className="text-right">
                        <span className="block text-sm font-semibold text-gray-800">{money(value)}</span>
                        <span className="text-[11px] text-gray-400">{shareLabel(value)}</span>
                      </span>
                    </div>
                    <Progress
                      value={shareOf(value) ?? 0}
                      className="h-1.5 bg-gray-100"
                      indicatorClassName={color}
                    />
                  </div>
                ))}
              </div>
            </div>
          </CardShell>
        </TabsContent>

        {/* Activité */}
        <TabsContent value="activity" className="space-y-4">
          <CardShell topBar>
            <div className="px-5 py-4">
              <SectionLabel className="mb-3 inline-block">Dernières actions</SectionLabel>
              {recentActions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center mb-2">
                    <Clock className="h-5 w-5 text-gray-400" />
                  </div>
                  <p className="text-sm text-gray-500">Aucune action récente</p>
                </div>
              ) : (
                <div>
                  {recentActions.map((action: any, i: number) => (
                    <div
                      key={action.id}
                      className={cn(
                        "flex items-center justify-between py-3 px-2 rounded-lg",
                        i % 2 === 0 ? "bg-gray-50/40" : "bg-transparent",
                        i < recentActions.length - 1 && "border-b border-gray-50"
                      )}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{action.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-gray-400">
                          <span>{action.vehicleRegistrationNumber || action.vehicleRegistration || "Véhicule n/a"}</span>
                          <span className="text-gray-200">•</span>
                          <span>{new Date(action.createdAt).toLocaleString('fr-FR', { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                      </div>
                      {statusChip(action.status)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardShell>
        </TabsContent>
      </Tabs>
    </div>
  );
}
