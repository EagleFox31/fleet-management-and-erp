import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  BarChart3, ClipboardList, Gauge, GraduationCap, Plus, TrendingUp,
  UserCircle2, Users, Wrench, Package, AlertTriangle, CheckCircle2, XCircle, Truck,
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
import { useLocation } from "wouter";
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

  // Repartition de la charge atelier. Le denominateur est la somme des trois
  // segments affiches: compter les annules gonflerait le total sans que la
  // barre les represente.
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
      pendingCount: pending, inProgressCount: inProgress, awaitingPartsCount: awaiting,
      completedCount: completed, activeCount: pending + inProgress + awaiting,
    };
  }).sort((a: any, b: any) => b.activeCount - a.activeCount);

  const maxTechLoad = Math.max(1, ...workloadByTechnician.map((t: any) => t.activeCount));
  const activeTechsCount = workloadByTechnician.filter((t: any) => t.activeCount > 0).length;

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Tableau de bord · Chef d'Atelier"
        title="Gestion de l'Atelier"
        subtitle="Ordres de travail, équipe, inventaire et formations CPC"
        icon={<Wrench className="h-5 w-5" />}
      >
        <KpiGrid columns={4}>
          <KpiTile
            data-testid="wm-kpi-vehicles-maintenance"
            label="Véhicules en maintenance"
            featured // les camions immobilises sont son probleme numero un
            value={`${maintenanceVehicles}/${totalVehicles}`}
            subValue="maintenance / flotte"
            icon={<Wrench className="h-4 w-4" />}
            iconWrapperClassName={maintenanceVehicles > 0 ? "bg-orange-50 text-orange-600" : "bg-gray-100 text-gray-400"}
            onClick={() => setLocation("/vehicles")}
          />
          <KpiTile
            data-testid="wm-kpi-compliance"
            label="Conformité maintenance"
            value={maintenanceComplianceTotal > 0 ? `${complianceRate.toFixed(0)}%` : "N/A"}
            // Sans donnée, ne rien affirmer: le sous-titre disait « À jour »
            // alors que rien n'avait été vérifié — `overdue` valait zéro parce
            // que le calcul n'existait pas, pas parce que la flotte l'était.
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
            label="Alertes stock"
            value={reorderAlertsCount}
            subValue={`${stockRiskCount} sous seuil`}
            icon={<AlertTriangle className="h-4 w-4" />}
            iconWrapperClassName={reorderAlertsCount > 0 ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-400"}
            valueClassName={reorderAlertsCount > 0 ? "text-amber-600" : undefined}
            onClick={() => setLocation("/inventory")}
          />
        </KpiGrid>
      </HeaderCard>

      <Tabs defaultValue="workshop">
        <PremiumTabsNav tabs={[
          { value: "workshop", label: "Atelier", icon: <TabIcon icon={Wrench} /> },
          { value: "inventory", label: "Inventaire", icon: <TabIcon icon={ClipboardList} /> },
          { value: "team", label: "Équipe", icon: <TabIcon icon={Users} /> },
          { value: "cpc", label: "CPC", icon: <TabIcon icon={GraduationCap} /> },
        ]} />

        {/* ── Atelier ── */}
        <TabsContent value="workshop" className="space-y-4">
          <CardShell>
            <div className="px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <SectionLabel>Ordres de travail</SectionLabel>
                <span className="text-xs text-gray-500">
                  {otTotal} au total
                  {otAnnules > 0 ? ` · ${otAnnules} annulé${otAnnules > 1 ? "s" : ""}` : ""}
                </span>
              </div>

              {/* Barre de proportion: on lit la charge de l'atelier d'un coup
                  d'oeil, ce que trois nombres cote a cote ne donnent pas. */}
              <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
                {otTotal > 0 && (
                  <>
                    <div className="bg-blue-500" style={{ width: `${(otEnAttente / otTotal) * 100}%` }} />
                    <div className="bg-orange-500" style={{ width: `${(otEnCours / otTotal) * 100}%` }} />
                    <div className="bg-green-500" style={{ width: `${(otTermines / otTotal) * 100}%` }} />
                  </>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                {[
                  { couleur: "bg-blue-500", libelle: "En attente", valeur: otEnAttente, statut: "pending" },
                  { couleur: "bg-orange-500", libelle: "En cours", valeur: otEnCours, statut: "in_progress" },
                  { couleur: "bg-green-500", libelle: "Terminés", valeur: otTermines, statut: "completed" },
                ].map((segment) => (
                  <button
                    key={segment.statut}
                    type="button"
                    onClick={() => setLocation(`/maintenance/work-orders?status=${segment.statut}`)}
                    className="group flex items-center gap-2 rounded-md px-1.5 py-1 -mx-1.5 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${segment.couleur}`} />
                    <span className="text-sm text-gray-600 group-hover:text-gray-900">{segment.libelle}</span>
                    <span className="text-base font-bold text-gray-900 tabular-nums">{segment.valeur}</span>
                  </button>
                ))}
              </div>

              {/* Rien en cours alors que des OT attendent: c'est le signal le
                  plus fort de l'ecran, il ne doit pas etre du meme gris que le reste. */}
              {atelierArrete && (
                <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Aucune intervention en cours alors que {otEnAttente} attende{otEnAttente > 1 ? "nt" : ""} — l'atelier est à l'arrêt.
                </p>
              )}
            </div>
          </CardShell>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Actions rapides</p>
                <div className="flex flex-col gap-2">
                  <Link href="/maintenance/work-orders/new">
                    <Button size="sm" className="justify-start gap-2 w-full" data-testid="btn-new-workorder">
                      <Plus className="h-3.5 w-3.5" /> Créer un ordre de travail
                    </Button>
                  </Link>
                  <Link href="/maintenance/work-orders">
                    <Button variant="outline" size="sm" className="justify-start gap-2 w-full" data-testid="btn-view-workorders">
                      <ClipboardList className="h-3.5 w-3.5" /> Voir tous les ordres de travail
                    </Button>
                  </Link>
                  <Link href="/maintenance/preventive">
                    <Button variant="outline" size="sm" className="justify-start gap-2 w-full" data-testid="btn-preventive">
                      <Wrench className="h-3.5 w-3.5" /> Maintenance préventive
                    </Button>
                  </Link>
                </div>
              </div>
            </CardShell>
            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Véhicules critiques</p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-1.5 border-b border-gray-50">
                    <span className="text-sm text-gray-500">Hors service</span>
                    <span className={`text-sm font-bold ${outOfServiceVehicles > 0 ? "text-red-600" : "text-gray-400"}`}>{outOfServiceVehicles}</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-gray-500">Maintenances en retard</span>
                    <span className={`text-sm font-bold ${overdueMaintenance > 0 ? "text-orange-600" : "text-gray-400"}`}>{overdueMaintenance}</span>
                  </div>
                </div>
              </div>
            </CardShell>
          </div>

          <CardShell>
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-semibold text-gray-800">Statut de la Flotte</span>
              </div>
              <VehicleStatusChart />
            </div>
          </CardShell>

          <OverdueInvoicesAlert />
        </TabsContent>

        {/* ── Inventaire ── */}
        <TabsContent value="inventory" className="space-y-4">
          <KpiGrid columns={3}>
            {warehouse.inventoryValue.isLoading ? (
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5"><Skeleton className="h-8 w-8 rounded-lg mb-2" /><Skeleton className="h-3 w-20" /></div>
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
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5"><Skeleton className="h-8 w-8 rounded-lg mb-2" /><Skeleton className="h-3 w-20" /></div>
            ) : (
              <KpiTile
                data-testid="wm-kpi-reorder"
                label="Alertes réappro"
                onClick={() => setLocation("/inventory")}
                value={`${reorderAlertsCount}/${totalStockParts}`}
                subValue={`Coût estimé ${formatPrice(warehouse.reorderAlerts.data?.estimatedCost || 0)}`}
                icon={<AlertTriangle className="h-4 w-4" />}
                iconWrapperClassName={reorderAlertsCount > 0 ? "bg-orange-50 text-orange-600" : "bg-gray-100 text-gray-400"}
              />
            )}
            {warehouse.statistics.isLoading ? (
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5"><Skeleton className="h-8 w-8 rounded-lg mb-2" /><Skeleton className="h-3 w-20" /></div>
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

          <CardShell>
            <div className="px-5 py-4">
              <div className="flex gap-2">
                <Link href="/inventory"><Button size="sm" className="gap-2" data-testid="btn-view-inventory"><Package className="h-3.5 w-3.5" /> Inventaire</Button></Link>
                <Link href="/inventory-requests"><Button variant="outline" size="sm" className="gap-2" data-testid="btn-view-requests"><ClipboardList className="h-3.5 w-3.5" /> Demandes de pièces</Button></Link>
              </div>
            </div>
          </CardShell>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardShell>
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3"><BarChart3 className="h-4 w-4 text-blue-500" /><span className="text-sm font-semibold text-gray-800">Top Pièces Consommées</span></div>
                <PartsConsumptionChart />
              </div>
            </CardShell>
            <CardShell>
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3"><TrendingUp className="h-4 w-4 text-green-500" /><span className="text-sm font-semibold text-gray-800">Évolution Valeur Stock</span></div>
                <StockValueChart />
              </div>
            </CardShell>
          </div>
        </TabsContent>

        {/* ── Équipe ── */}
        <TabsContent value="team" className="space-y-4">
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
            <CardShell>
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3"><Gauge className="h-4 w-4 text-blue-500" /><span className="text-sm font-semibold text-gray-800">Répartition des OT équipe</span></div>
                <div className="space-y-3">
                  {[
                    { label: "En attente", count: teamPendingWorkOrders.length, color: "bg-blue-500" },
                    { label: "En cours", count: teamInProgressWorkOrders.length, color: "bg-orange-500" },
                    { label: "Attente pièces", count: teamAwaitingPartsWorkOrders.length, color: "bg-amber-500" },
                    { label: "Terminés", count: teamCompletedWorkOrders.length, color: "bg-green-500" },
                  ].map(({ label, count, color }) => (
                    <div key={label}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-gray-500">{label}</span>
                        <span className="font-semibold text-gray-800">{count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100">
                        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${Math.min(100, (count / Math.max(1, assignedWorkOrders.length)) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardShell>

            <CardShell>
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3"><Users className="h-4 w-4 text-purple-500" /><span className="text-sm font-semibold text-gray-800">Charge par technicien</span></div>
                {workloadByTechnician.length === 0 ? (
                  <p className="text-xs text-gray-400">Aucun technicien disponible.</p>
                ) : (
                  <div className="space-y-3">
                    {workloadByTechnician.slice(0, 6).map((tech: any) => (
                      <div key={tech.id} className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                            <UserCircle2 className="h-3.5 w-3.5 text-gray-400" />{tech.name}
                          </span>
                          <span className="text-xs font-bold text-gray-600">{tech.activeCount} actifs</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-200">
                          <div className="h-1.5 rounded-full bg-green-500" style={{ width: `${Math.min(100, (tech.activeCount / maxTechLoad) * 100)}%` }} />
                        </div>
                        <div className="flex gap-3 mt-1 text-[10px] text-gray-400">
                          <span>En cours: {tech.inProgressCount}</span>
                          <span>Attente: {tech.pendingCount}</span>
                          <span>Terminés: {tech.completedCount}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardShell>
          </div>

          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Gestion de l'équipe</p>
              <p className="text-xs text-gray-400 mb-3">{teamMembers.length} membres · {unassignedWorkOrdersCount} OT non assignés</p>
              <div className="flex flex-col gap-2">
                <Link href="/technicians"><Button size="sm" className="justify-start gap-2 w-full" data-testid="btn-view-technicians"><Users className="h-3.5 w-3.5" /> Voir les techniciens</Button></Link>
                <Link href="/maintenance/work-orders"><Button variant="outline" size="sm" className="justify-start gap-2 w-full" data-testid="btn-assign-workorders"><ClipboardList className="h-3.5 w-3.5" /> Assigner / suivre les ordres de travail</Button></Link>
                <Link href="/maintenance/interventions"><Button variant="outline" size="sm" className="justify-start gap-2 w-full" data-testid="btn-view-interventions"><Wrench className="h-3.5 w-3.5" /> Historique interventions</Button></Link>
              </div>
            </div>
          </CardShell>
        </TabsContent>

        {/* ── CPC ── */}
        <TabsContent value="cpc" className="space-y-4">
          <KpiGrid columns={3}>
            <KpiTile
              data-testid="wm-kpi-cpc-formed"
              label="Chauffeurs formés"
              value={cpcFormed}
              subValue={`/ ${cpcTotal} total`}
              icon={<CheckCircle2 className="h-4 w-4" />}
              iconWrapperClassName="bg-green-50 text-green-600"
            />
            <KpiTile
              data-testid="wm-kpi-cpc-to-form"
              label="À former"
              value={cpcToTrain}
              subValue="Alertes actives"
              icon={<AlertTriangle className="h-4 w-4" />}
              iconWrapperClassName={cpcToTrain > 0 ? "bg-orange-50 text-orange-600" : "bg-gray-100 text-gray-400"}
              valueClassName={cpcToTrain > 0 ? "text-orange-600" : undefined}
            />
            <KpiTile
              data-testid="wm-kpi-cpc-not-formed"
              label="Non formés"
              value={cpcNotFormed}
              subValue="Nécessite formation"
              icon={<XCircle className="h-4 w-4" />}
              iconWrapperClassName={cpcNotFormed > 0 ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-400"}
              valueClassName={cpcNotFormed > 0 ? "text-red-600" : undefined}
            />
          </KpiGrid>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardShell>
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3"><BarChart3 className="h-4 w-4 text-purple-500" /><span className="text-sm font-semibold text-gray-800">Répartition Statuts CPC</span></div>
                <CPCStatusChart />
              </div>
            </CardShell>
            <CPCAlertsPanel />
          </div>

          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Mise à jour certifications CPC</p>
              <p className="text-xs text-gray-400 mb-3">Mettez à jour les dates de formation CPC pour les chauffeurs de votre équipe.</p>
            </div>
          </CardShell>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {driversStatus?.slice(0, 6).map((driver: any) => (
              <CPCUpdateForm key={driver.id} driverId={driver.id} driverName={`${driver.firstName} ${driver.lastName}`} currentCPCDate={driver.cpcTrainingDate} currentStatus={driver.cpcStatus} />
            ))}
          </div>
          {driversStatus && driversStatus.length > 6 && (
            <CardShell>
              <div className="px-5 py-3 text-center">
                <p className="text-xs text-gray-400">Affichage des 6 premiers. <Link href="/drivers"><span className="text-green-600 hover:underline cursor-pointer">Voir tous les chauffeurs</span></Link></p>
              </div>
            </CardShell>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
