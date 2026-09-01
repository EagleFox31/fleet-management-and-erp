import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  BarChart3,
  ClipboardList,
  Gauge,
  GraduationCap,
  Plus,
  TrendingUp,
  UserCircle2,
  Users,
  Wrench,
  Package,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Truck,
  ArrowRight,
  Clock,
  Sparkles,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CPCStatusChart } from "@/components/charts/cpc-status-chart";
import { CPCAlertsPanel } from "@/components/drivers/cpc-alerts-panel";
import { PartsConsumptionChart } from "@/components/charts/parts-consumption-chart";
import { StockValueChart } from "@/components/charts/stock-value-chart";
import { VehicleStatusChart } from "@/components/charts/vehicle-status-chart";
import { CPCUpdateForm } from "@/components/drivers/cpc-update-form";
import { OverdueInvoicesAlert } from "@/components/dashboard/overdue-invoices-alert";
import { HeaderCard, KpiGrid, KpiTile, CardShell, SectionLabel, PremiumTabsNav } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { formatPrice } from "@/lib/utils";
import { useWarehouse } from "@/hooks/useWarehouse";

export default function WorkshopManagerDashboard() {
  const [, setLocation] = useLocation();
  const warehouse = useWarehouse();

  const { data: workOrderStats } = useQuery<any>({ queryKey: ["/api/work-orders/statistics"] });
  const { data: teamMembers = [] } = useQuery<any[]>({ queryKey: ["/api/users/technicians"] });
  const { data: workOrdersData } = useQuery<any>({ queryKey: ["/api/work-orders"] });
  const { data: fleetStats } = useQuery<any>({ queryKey: ["/api/statistics/fleet"] });
  const { data: complianceStats } = useQuery<any>({ queryKey: ["/api/statistics/maintenance-compliance"] });
  const { data: cpcStats } = useQuery<any>({ queryKey: ["/api/drivers/cpc-statistics"] });
  const { data: driversStatus } = useQuery<any>({ queryKey: ["/api/drivers/cpc-status"] });

  const maintenanceVehicles = Number.parseInt(fleetStats?.maintenance || "0", 10) || 0;
  const operationalVehicles = Number.parseInt(fleetStats?.operational || "0", 10) || 0;
  const outOfServiceVehicles = Number.parseInt(fleetStats?.outOfService || "0", 10) || 0;
  const totalVehicles = maintenanceVehicles + operationalVehicles + outOfServiceVehicles;
  const compliantMaintenance = Number(complianceStats?.compliant || 0);
  const overdueMaintenance = Number(complianceStats?.overdue || 0);
  const maintenanceComplianceTotal = Number(complianceStats?.total || 0);
  const complianceRate = maintenanceComplianceTotal > 0 ? (compliantMaintenance / maintenanceComplianceTotal) * 100 : 0;
  const availabilityRateRaw = Number(fleetStats?.availabilityRate);
  const availabilityRate = Number.isFinite(availabilityRateRaw)
    ? availabilityRateRaw
    : totalVehicles > 0 ? (operationalVehicles / totalVehicles) * 100 : 0;

  const lowStockCount = Number(warehouse.statistics.data?.lowStockCount || 0);
  const outOfStockCount = Number(warehouse.statistics.data?.outOfStockCount || 0);
  const reorderAlertsCount = Number(warehouse.reorderAlerts.data?.totalAlerts || 0);
  const stockValue = Number(warehouse.inventoryValue.data?.totalValue || 0);
  const totalStockParts = Number(warehouse.inventoryValue.data?.totalParts || 0);
  const stockRiskCount = lowStockCount + outOfStockCount;

  const cpcTotal = Number(cpcStats?.total || 0);
  const cpcFormed = Number(cpcStats?.forme || 0);
  const cpcToTrain = Number(cpcStats?.aFormer || 0);
  const cpcNotFormed = Number(cpcStats?.nonForme || 0);

  const allWorkOrders = Array.isArray(workOrdersData?.workOrders) ? workOrdersData.workOrders : [];
  const techniciansOnly = Array.isArray(teamMembers) ? teamMembers.filter((m: any) => m?.role === "technician") : [];
  const activeOrderStatuses = new Set(["pending", "in_progress", "awaiting_parts"]);
  const workshopInProgressCount =
    Number(workOrderStats?.inProgress || 0) + Number(workOrderStats?.awaitingParts || 0);

  const otEnAttente = Number(workOrderStats?.pending || 0);
  const otEnCours = workshopInProgressCount;
  const otTermines = Number(workOrderStats?.completed || 0);
  const otTotal = otEnAttente + otEnCours + otTermines;
  const otAnnules = Number(workOrderStats?.cancelled || 0);
  const atelierArrete = otEnCours === 0 && otEnAttente > 0;

  const assignedWorkOrders = allWorkOrders.filter((wo: any) => {
    const id = Number(wo?.technicianId);
    return Number.isFinite(id) && id > 0;
  });
  const unassignedWorkOrdersCount = allWorkOrders.filter((wo: any) => {
    const raw = wo?.technicianId;
    if (raw === null || raw === undefined || raw === "") return true;
    const p = Number(raw);
    return !Number.isFinite(p) || p <= 0;
  }).length;

  const teamActiveWorkOrders = assignedWorkOrders.filter((wo: any) => activeOrderStatuses.has(String(wo?.status || "")));
  const teamCompletedWorkOrders = assignedWorkOrders.filter((wo: any) => wo?.status === "completed");
  const teamPendingWorkOrders = assignedWorkOrders.filter((wo: any) => wo?.status === "pending");
  const teamInProgressWorkOrders = assignedWorkOrders.filter((wo: any) => wo?.status === "in_progress");
  const teamAwaitingPartsWorkOrders = assignedWorkOrders.filter((wo: any) => wo?.status === "awaiting_parts");
  const teamCompletionRate = assignedWorkOrders.length > 0 ? (teamCompletedWorkOrders.length / assignedWorkOrders.length) * 100 : 0;
  const averageActivePerTech = techniciansOnly.length > 0 ? teamActiveWorkOrders.length / techniciansOnly.length : 0;

  const workloadByTechnician = techniciansOnly.map((tech: any) => {
    const techId = Number(tech?.id);
    const orders = assignedWorkOrders.filter((wo: any) => Number(wo?.technicianId) === techId);
    const pending = orders.filter((wo: any) => wo?.status === "pending").length;
    const inProgress = orders.filter((wo: any) => wo?.status === "in_progress").length;
    const awaiting = orders.filter((wo: any) => wo?.status === "awaiting_parts").length;
    const completed = orders.filter((wo: any) => wo?.status === "completed").length;
    return {
      id: techId,
      name: tech?.name || tech?.username || `Technicien #${techId}`,
      pendingCount: pending,
      inProgressCount: inProgress,
      awaitingPartsCount: awaiting,
      completedCount: completed,
      activeCount: pending + inProgress + awaiting,
    };
  }).sort((a: any, b: any) => b.activeCount - a.activeCount);

  const maxTechLoad = Math.max(1, ...workloadByTechnician.map((t: any) => t.activeCount));
  const activeTechsCount = workloadByTechnician.filter((t: any) => t.activeCount > 0).length;

  return (
    <div className="space-y-6">
      {/* 1. Header Card Exécutif Atelier */}
      <HeaderCard
        moduleLabel="Tableau de bord · Chef d'Atelier"
        title="Gestion &amp; Pilotage de l'Atelier"
        subtitle="Supervision de la charge mécanique, disponibilité flotte, pièces détachées et certifications"
        icon={<Wrench className="h-5 w-5" />}
        actions={
          <Link href="/maintenance/work-orders/new">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl shadow-xs gap-1.5 cursor-pointer">
              <Plus className="h-4 w-4" />
              Créer un OT
            </Button>
          </Link>
        }
      >
        <KpiGrid columns={4}>
          <KpiTile
            data-testid="wm-kpi-vehicles-maintenance"
            label="Véhicules en maintenance"
            featured
            value={`${maintenanceVehicles}/${totalVehicles}`}
            subValue="immobilisés / total flotte"
            icon={<Wrench className="h-4 w-4" />}
            iconWrapperClassName={maintenanceVehicles > 0 ? "bg-orange-50 text-orange-600" : "bg-gray-100 text-gray-400"}
            onClick={() => setLocation("/vehicles")}
          />
          <KpiTile
            data-testid="wm-kpi-compliance"
            label="Conformité maintenance"
            value={maintenanceComplianceTotal > 0 ? `${complianceRate.toFixed(0)}%` : "N/A"}
            subValue={
              maintenanceComplianceTotal === 0
                ? "Aucun entretien programmé"
                : overdueMaintenance > 0
                  ? `${overdueMaintenance} en retard sur ${maintenanceComplianceTotal}`
                  : `${maintenanceComplianceTotal} véhicules à jour`
            }
            icon={<CheckCircle2 className="h-4 w-4" />}
            iconWrapperClassName={overdueMaintenance > 0 ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"}
            valueClassName={overdueMaintenance > 0 ? "text-red-600" : undefined}
            onClick={() => setLocation("/maintenance/preventive")}
          />
          <KpiTile
            data-testid="wm-kpi-availability"
            label="Disponibilité flotte"
            value={`${availabilityRate.toFixed(0)}%`}
            subValue={`${operationalVehicles}/${totalVehicles} opérationnels`}
            icon={<Truck className="h-4 w-4" />}
            iconWrapperClassName={availabilityRate >= 70 ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"}
            valueClassName={availabilityRate < 70 ? "text-red-600" : undefined}
            onClick={() => setLocation("/vehicles")}
          />
          <KpiTile
            label="Alertes stock magasin"
            value={reorderAlertsCount}
            subValue={`${stockRiskCount} références sous seuil`}
            icon={<AlertTriangle className="h-4 w-4" />}
            iconWrapperClassName={reorderAlertsCount > 0 ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-400"}
            valueClassName={reorderAlertsCount > 0 ? "text-amber-600" : undefined}
            onClick={() => setLocation("/inventory")}
          />
        </KpiGrid>
      </HeaderCard>

      {/* 2. Navigation par Onglets Bento Modernes */}
      <Tabs defaultValue="workshop" className="space-y-6">
        <PremiumTabsNav tabs={[
          { value: "workshop", label: "Atelier & Charge", icon: <TabIcon icon={Wrench} /> },
          { value: "inventory", label: "Inventaire & Pièces", icon: <TabIcon icon={Package} /> },
          { value: "team", label: "Équipe & Techniciens", icon: <TabIcon icon={Users} /> },
          { value: "cpc", label: "Certifications CPC", icon: <TabIcon icon={GraduationCap} /> },
        ]} />

        {/* ========================================================================= */}
        {/* ONGLET 1 : Atelier & Charge Opérationnelle                                */}
        {/* ========================================================================= */}
        <TabsContent value="workshop" className="space-y-5">
          {/* Bento Hero : Répartition de la Charge Atelier */}
          <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <SectionLabel>Charge Globale de l'Atelier</SectionLabel>
                  {atelierArrete ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Atelier à l'arrêt
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                      <Zap className="h-3 w-3" /> Atelier en activité
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Visualisation en temps réel de l'avancement des ordres de travail
                </p>
              </div>

              <span className="text-xs font-semibold text-muted-foreground">
                {otTotal} OT au total {otAnnules > 0 ? `· ${otAnnules} annulé(s)` : ""}
              </span>
            </div>

            {/* Barre de proportion moderne tricolore */}
            <div className="h-3.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200/60 dark:border-slate-700 flex">
              {otTotal > 0 && (
                <>
                  <div
                    className="bg-blue-500 rounded-l-full transition-all duration-300"
                    style={{ width: `${(otEnAttente / otTotal) * 100}%` }}
                    title={`En attente: ${otEnAttente}`}
                  />
                  <div
                    className="bg-amber-500 transition-all duration-300"
                    style={{ width: `${(otEnCours / otTotal) * 100}%` }}
                    title={`En cours: ${otEnCours}`}
                  />
                  <div
                    className="bg-emerald-500 rounded-r-full transition-all duration-300"
                    style={{ width: `${(otTermines / otTotal) * 100}%` }}
                    title={`Terminés: ${otTermines}`}
                  />
                </>
              )}
            </div>

            {/* Boutons de filtres interactifs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              {[
                {
                  couleurBg: "bg-blue-50/70 dark:bg-blue-950/30 border-blue-200/60 text-blue-700 dark:text-blue-300",
                  dotColor: "bg-blue-500",
                  libelle: "En attente",
                  valeur: otEnAttente,
                  statut: "pending",
                  desc: "Assignations en file",
                },
                {
                  couleurBg: "bg-amber-50/70 dark:bg-amber-950/30 border-amber-200/60 text-amber-700 dark:text-amber-300",
                  dotColor: "bg-amber-500",
                  libelle: "En cours & pièces",
                  valeur: otEnCours,
                  statut: "in_progress",
                  desc: "Interventions actives",
                },
                {
                  couleurBg: "bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200/60 text-emerald-700 dark:text-emerald-300",
                  dotColor: "bg-emerald-500",
                  libelle: "Terminés",
                  valeur: otTermines,
                  statut: "completed",
                  desc: "Clôturés avec succès",
                },
              ].map((segment) => (
                <button
                  key={segment.statut}
                  type="button"
                  onClick={() => setLocation(`/maintenance/work-orders?status=${segment.statut}`)}
                  className={`p-3.5 rounded-2xl border text-left transition-all hover:scale-[1.01] cursor-pointer flex items-center justify-between ${segment.couleurBg}`}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${segment.dotColor}`} />
                      <span className="text-xs font-bold">{segment.libelle}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground block">{segment.desc}</span>
                  </div>
                  <span className="text-2xl font-black tabular-nums">{segment.valeur}</span>
                </button>
              ))}
            </div>

            {atelierArrete && (
              <div className="p-3 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>Attention : Aucune intervention en cours alors que {otEnAttente} OT attendent d'être traités.</span>
              </div>
            )}
          </div>

          {/* Grille 2 colonnes : Actions Rapides & Véhicules Critiques */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-600" /> Actions Rapides Atelier
                </p>
                <div className="space-y-2">
                  <Link href="/maintenance/work-orders/new">
                    <Button size="sm" className="w-full justify-between bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl cursor-pointer">
                      <span className="flex items-center gap-2">
                        <Plus className="h-4 w-4" /> Créer un ordre de travail
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 opacity-70" />
                    </Button>
                  </Link>
                  <Link href="/maintenance/work-orders">
                    <Button variant="outline" size="sm" className="w-full justify-between rounded-xl">
                      <span className="flex items-center gap-2">
                        <ClipboardList className="h-4 w-4 text-blue-600" /> Tous les ordres de travail
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 opacity-70" />
                    </Button>
                  </Link>
                  <Link href="/maintenance/preventive">
                    <Button variant="outline" size="sm" className="w-full justify-between rounded-xl">
                      <span className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-purple-600" /> Maintenance préventive &amp; vidanges
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 opacity-70" />
                    </Button>
                  </Link>
                </div>
              </div>
            </div>

            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Véhicules Critiques &amp; Retards
                </p>
                <div className="space-y-2.5">
                  <div className="p-3 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/60 flex items-center justify-between">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-rose-900 dark:text-rose-300">Véhicules Hors Service</span>
                      <span className="text-[11px] text-muted-foreground block">Immobilisés en urgence</span>
                    </div>
                    <span className="text-xl font-black text-rose-700 dark:text-rose-400 tabular-nums">
                      {outOfServiceVehicles}
                    </span>
                  </div>

                  <div className="p-3 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 flex items-center justify-between">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-amber-900 dark:text-amber-300">Entretiens en Retard</span>
                      <span className="text-[11px] text-muted-foreground block">Échéances kilométriques dépassées</span>
                    </div>
                    <span className="text-xl font-black text-amber-700 dark:text-amber-400 tabular-nums">
                      {overdueMaintenance}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Graphique Statut Flotte */}
          <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-bold text-foreground">Disponibilité Globale du Parc Roulant</span>
            </div>
            <VehicleStatusChart />
          </div>

          <OverdueInvoicesAlert />
        </TabsContent>

        {/* ========================================================================= */}
        {/* ONGLET 2 : Inventaire & Pièces Détachées                                  */}
        {/* ========================================================================= */}
        <TabsContent value="inventory" className="space-y-5">
          <KpiGrid columns={3}>
            {warehouse.inventoryValue.isLoading ? (
              <Skeleton className="h-28 w-full rounded-3xl" />
            ) : (
              <KpiTile
                data-testid="wm-kpi-stock-value"
                label="Valeur stock pièces"
                onClick={() => setLocation("/inventory")}
                value={formatPrice(stockValue)}
                subValue={`${totalStockParts} références · ${stockRiskCount} sous seuil`}
                icon={<Package className="h-4 w-4" />}
                iconWrapperClassName="bg-purple-50 text-purple-600"
              />
            )}
            {warehouse.reorderAlerts.isLoading ? (
              <Skeleton className="h-28 w-full rounded-3xl" />
            ) : (
              <KpiTile
                data-testid="wm-kpi-reorder"
                label="Alertes réappro magasin"
                onClick={() => setLocation("/inventory")}
                value={`${reorderAlertsCount}/${totalStockParts}`}
                subValue={`Coût estimé ${formatPrice(warehouse.reorderAlerts.data?.estimatedCost || 0)}`}
                icon={<AlertTriangle className="h-4 w-4" />}
                iconWrapperClassName={reorderAlertsCount > 0 ? "bg-orange-50 text-orange-600" : "bg-gray-100 text-gray-400"}
              />
            )}
            {warehouse.statistics.isLoading ? (
              <Skeleton className="h-28 w-full rounded-3xl" />
            ) : (
              <KpiTile
                data-testid="wm-kpi-lowstock"
                label="Stock bas / épuisé"
                onClick={() => setLocation("/inventory")}
                value={`${stockRiskCount}/${totalStockParts}`}
                subValue={`${lowStockCount} bas · ${outOfStockCount} épuisés`}
                icon={<Package className="h-4 w-4" />}
                iconWrapperClassName={stockRiskCount > 0 ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-400"}
                valueClassName={stockRiskCount > 0 ? "text-red-600" : undefined}
              />
            )}
          </KpiGrid>

          {/* Raccourcis d'inventaire */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground font-medium">
              Accès direct au catalogue des pièces détachées et aux demandes de réassort
            </span>
            <div className="flex items-center gap-2">
              <Link href="/inventory">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl gap-1.5 cursor-pointer">
                  <Package className="h-3.5 w-3.5" /> Catalogue Pièces
                </Button>
              </Link>
              <Link href="/inventory-requests">
                <Button variant="outline" size="sm" className="rounded-xl gap-1.5">
                  <ClipboardList className="h-3.5 w-3.5 text-blue-600" /> Demandes de Pièces
                </Button>
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-bold text-foreground">Top Pièces Consommées en Atelier</span>
              </div>
              <PartsConsumptionChart />
            </div>

            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-bold text-foreground">Évolution de la Valeur du Stock</span>
              </div>
              <StockValueChart />
            </div>
          </div>
        </TabsContent>

        {/* ========================================================================= */}
        {/* ONGLET 3 : Équipe & Techniciens                                          */}
        {/* ========================================================================= */}
        <TabsContent value="team" className="space-y-5">
          <KpiGrid columns={4}>
            <KpiTile
              data-testid="wm-team-kpi-technicians"
              label="Techniciens actifs"
              onClick={() => setLocation("/technicians")}
              value={`${activeTechsCount}/${techniciansOnly.length}`}
              subValue="avec OT actif / total"
              icon={<Users className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
            />
            <KpiTile
              data-testid="wm-team-kpi-active-workorders"
              label="OT en cours équipe"
              onClick={() => setLocation("/maintenance/work-orders?status=in_progress")}
              value={`${teamActiveWorkOrders.length}/${assignedWorkOrders.length}`}
              subValue={`${unassignedWorkOrdersCount} non assignés`}
              icon={<ClipboardList className="h-4 w-4" />}
              iconWrapperClassName="bg-orange-50 text-orange-600"
            />
            <KpiTile
              data-testid="wm-team-kpi-completion-rate"
              label="Taux de clôture"
              value={`${teamCompletionRate.toFixed(0)}%`}
              subValue={`${teamCompletedWorkOrders.length}/${assignedWorkOrders.length}`}
              icon={<CheckCircle2 className="h-4 w-4" />}
              iconWrapperClassName="bg-green-50 text-green-600"
            />
            <KpiTile
              data-testid="wm-team-kpi-average-load"
              label="Charge moyenne"
              value={averageActivePerTech.toFixed(1)}
              subValue={`OT/tech · Pic: ${maxTechLoad}`}
              icon={<Gauge className="h-4 w-4" />}
              iconWrapperClassName="bg-purple-50 text-purple-600"
            />
          </KpiGrid>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Répartition des OT par Statut */}
            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-bold text-foreground">Répartition des OT de l'Équipe</span>
              </div>
              <div className="space-y-3">
                {[
                  { label: "En attente", count: teamPendingWorkOrders.length, color: "bg-blue-500" },
                  { label: "En cours", count: teamInProgressWorkOrders.length, color: "bg-orange-500" },
                  { label: "Attente pièces", count: teamAwaitingPartsWorkOrders.length, color: "bg-amber-500" },
                  { label: "Terminés", count: teamCompletedWorkOrders.length, color: "bg-emerald-500" },
                ].map(({ label, count, color }) => (
                  <div key={label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-bold text-foreground">{count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${color}`}
                        style={{ width: `${Math.min(100, (count / Math.max(1, assignedWorkOrders.length)) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Charge détaillée par Technicien */}
            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-purple-600" />
                <span className="text-sm font-bold text-foreground">Charge de Travail par Technicien</span>
              </div>
              {workloadByTechnician.length === 0 ? (
                <p className="text-xs text-muted-foreground">Aucun technicien disponible.</p>
              ) : (
                <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                  {workloadByTechnician.slice(0, 6).map((tech: any) => (
                    <div key={tech.id} className="p-3 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                          <UserCircle2 className="h-4 w-4 text-slate-400" />
                          {tech.name}
                        </span>
                        <span className="text-[11px] font-extrabold text-emerald-600 dark:text-emerald-400">
                          {tech.activeCount} OT actif(s)
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${Math.min(100, (tech.activeCount / maxTechLoad) * 100)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
                        <span>En cours : {tech.inProgressCount}</span>
                        <span>En attente : {tech.pendingCount}</span>
                        <span>Terminés : {tech.completedCount}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Raccourcis Équipe */}
          <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Pilotage des Effectifs</p>
                <p className="text-xs text-muted-foreground mt-0.5">{teamMembers.length} membres de l'atelier · {unassignedWorkOrdersCount} OT non assignés</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/technicians">
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl gap-1.5 cursor-pointer">
                    <Users className="h-3.5 w-3.5" /> Fiches Techniciens
                  </Button>
                </Link>
                <Link href="/maintenance/work-orders">
                  <Button variant="outline" size="sm" className="rounded-xl gap-1.5">
                    <ClipboardList className="h-3.5 w-3.5 text-blue-600" /> Assigner les OT
                  </Button>
                </Link>
                <Link href="/maintenance/interventions">
                  <Button variant="outline" size="sm" className="rounded-xl gap-1.5">
                    <Wrench className="h-3.5 w-3.5 text-purple-600" /> Historique Travaux
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ========================================================================= */}
        {/* ONGLET 4 : Certifications & Formations CPC                                */}
        {/* ========================================================================= */}
        <TabsContent value="cpc" className="space-y-5">
          <KpiGrid columns={3}>
            <KpiTile
              data-testid="wm-kpi-cpc-formed"
              label="Chauffeurs certifiés CPC"
              value={cpcFormed}
              subValue={`/ ${cpcTotal} chauffeurs au total`}
              icon={<CheckCircle2 className="h-4 w-4" />}
              iconWrapperClassName="bg-emerald-50 text-emerald-600"
            />
            <KpiTile
              data-testid="wm-kpi-cpc-to-form"
              label="À recycler / former"
              value={cpcToTrain}
              subValue="Alertes échéances actives"
              icon={<AlertTriangle className="h-4 w-4" />}
              iconWrapperClassName={cpcToTrain > 0 ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-400"}
              valueClassName={cpcToTrain > 0 ? "text-amber-600" : undefined}
            />
            <KpiTile
              data-testid="wm-kpi-cpc-not-formed"
              label="Non certifiés"
              value={cpcNotFormed}
              subValue="Formation requise"
              icon={<XCircle className="h-4 w-4" />}
              iconWrapperClassName={cpcNotFormed > 0 ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-400"}
              valueClassName={cpcNotFormed > 0 ? "text-red-600" : undefined}
            />
          </KpiGrid>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-purple-600" />
                <span className="text-sm font-bold text-foreground">Répartition des Certifications CPC</span>
              </div>
              <CPCStatusChart />
            </div>

            <CPCAlertsPanel />
          </div>

          {/* Formulaires de mise à jour rapide */}
          <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Mise à Jour des Certifications CPC</p>
              <p className="text-xs text-muted-foreground mt-0.5">Enregistrement rapide des dates de validité pour les chauffeurs</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {driversStatus?.slice(0, 6).map((driver: any) => (
                <CPCUpdateForm
                  key={driver.id}
                  driverId={driver.id}
                  driverName={`${driver.firstName} ${driver.lastName}`}
                  currentCPCDate={driver.cpcTrainingDate}
                  currentStatus={driver.cpcStatus}
                />
              ))}
            </div>

            {driversStatus && driversStatus.length > 6 && (
              <div className="text-center pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-muted-foreground">
                Affichage des 6 premiers chauffeurs.{" "}
                <Link href="/drivers">
                  <span className="text-emerald-600 font-bold hover:underline cursor-pointer">Voir tous les conducteurs</span>
                </Link>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
