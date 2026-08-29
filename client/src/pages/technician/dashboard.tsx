import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Wrench,
  ClipboardList,
  CheckCircle2,
  AlertTriangle,
  ListChecks,
  Truck,
  Clock,
  XCircle,
} from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeaderCard, KpiGrid, KpiTile, CardShell, PremiumTabsNav } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { cn, formatDate, getStatusColor, translatePriority, translateStatus } from "@/lib/utils";

type WorkOrderStatus = "pending" | "in_progress" | "completed" | "cancelled";
type WorkOrderPriority = "critical" | "high" | "medium" | "low" | string;

interface TechnicianWorkOrder {
  id: number;
  title: string;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  createdAt: string;
  updatedAt?: string | null;
  endDate?: string | null;
  vehicleRegistrationNumber?: string;
  isOverdue?: boolean;
}

interface TechnicianWorkOrdersResponse {
  workOrders: TechnicianWorkOrder[];
  stats?: { pending: number; inProgress: number; completed: number; overdue: number; total: number };
  total: number;
}

interface FleetStats {
  operational: number;
  maintenance: number;
  outOfService: number;
  total: number;
}

const ACTIVE_STATUSES = new Set<WorkOrderStatus>(["pending", "in_progress"]);

function getDisplayDate(wo: TechnicianWorkOrder): Date | null {
  const v = wo.endDate || wo.updatedAt || wo.createdAt;
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isSameDay(date: Date | null, other: Date) {
  return !!date && date.toDateString() === other.toDateString();
}

export default function TechnicianDashboard() {
  const [, setLocation] = useLocation();

  const { data: workOrdersData, isLoading: workOrdersLoading } = useQuery<TechnicianWorkOrdersResponse>({
    queryKey: ["/api/technician/my-work-orders"],
  });

  const { data: fleetStats } = useQuery<FleetStats>({
    queryKey: ["/api/statistics/fleet"],
  });

  const workOrders = workOrdersData?.workOrders || [];
  const activeWorkOrders = workOrders.filter((wo) => ACTIVE_STATUSES.has(wo.status));

  const completedToday = workOrders.filter(
    (wo) => wo.status === "completed" && isSameDay(getDisplayDate(wo), new Date()),
  ).length;

  const inProgressCount = workOrdersData?.stats?.inProgress ?? workOrders.filter((wo) => wo.status === "in_progress").length;
  const pendingCount = workOrdersData?.stats?.pending ?? workOrders.filter((wo) => wo.status === "pending").length;
  const completedCount = workOrdersData?.stats?.completed ?? workOrders.filter((wo) => wo.status === "completed").length;
  const overdueCount = workOrdersData?.stats?.overdue ?? workOrders.filter((wo) => wo.status !== "completed" && wo.status !== "cancelled" && Boolean(wo.isOverdue)).length;

  const urgentWorkOrders = workOrders
    .filter((wo) => wo.status !== "completed" && wo.status !== "cancelled" && (wo.priority === "critical" || wo.priority === "high" || Boolean(wo.isOverdue)))
    .sort((a, b) => (a.priority === "critical" ? -1 : 1) - (b.priority === "critical" ? -1 : 1))
    .slice(0, 5);

  const recentWorkOrders = [...workOrders]
    .sort((a, b) => (getDisplayDate(b)?.getTime() || 0) - (getDisplayDate(a)?.getTime() || 0))
    .slice(0, 5);

  const operationalCount = Number(fleetStats?.operational || 0);
  const maintenanceCount = Number(fleetStats?.maintenance || 0);
  const outOfServiceCount = Number(fleetStats?.outOfService || 0);

  const goToMyWorkOrders = (status?: "pending" | "in_progress" | "completed") =>
    setLocation(status ? `/technician/my-work-orders?status=${status}` : "/technician/my-work-orders");

  if (workOrdersLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Tableau de bord · Technicien"
        title="Mes Interventions"
        subtitle="Ordres de travail assignés et état de la flotte"
        icon={<Wrench className="h-5 w-5" />}
      >
        <KpiGrid columns={4}>
          <KpiTile
            data-testid="tech-kpi-assigned"
            label="Ordres assignés"
            featured // sa file de travail du jour
            value={activeWorkOrders.length}
            subValue="À traiter"
            icon={<ClipboardList className="h-4 w-4" />}
            iconWrapperClassName={overdueCount > 0 ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}
            valueClassName={overdueCount > 0 ? "text-red-600" : undefined}
            className="cursor-pointer"
            onClick={() => goToMyWorkOrders("pending")}
          />
          <KpiTile
            data-testid="tech-kpi-completed"
            label="Terminés aujourd'hui"
            value={completedToday}
            subValue="Clôturés ce jour"
            icon={<CheckCircle2 className="h-4 w-4" />}
            iconWrapperClassName="bg-green-50 text-green-600"
            className="cursor-pointer"
            onClick={() => goToMyWorkOrders("completed")}
          />
          <KpiTile
            data-testid="tech-kpi-inprogress"
            label="En cours"
            value={inProgressCount}
            subValue="Actifs"
            icon={<Wrench className="h-4 w-4" />}
            iconWrapperClassName="bg-orange-50 text-orange-600"
            className="cursor-pointer"
            onClick={() => goToMyWorkOrders("in_progress")}
          />
          <KpiTile
            label="En retard"
            value={overdueCount}
            subValue="Dépassé échéance"
            icon={<Clock className="h-4 w-4" />}
            iconWrapperClassName={overdueCount > 0 ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-400"}
            valueClassName={overdueCount > 0 ? "text-red-600" : undefined}
          />
        </KpiGrid>
      </HeaderCard>

      <Tabs defaultValue="work">
        <PremiumTabsNav tabs={[
          { value: "work", label: "Ordres de travail", icon: <TabIcon icon={Wrench} /> },
          { value: "fleet", label: "État de la flotte", icon: <TabIcon icon={Truck} /> },
        ]} />

        <TabsContent value="work" className="space-y-4">
          {activeWorkOrders.length === 0 && (
            <CardShell>
              <div className="py-10 flex flex-col items-center text-center gap-3 px-5">
                <CheckCircle2 className="h-10 w-10 text-green-500 opacity-60" />
                <p className="text-sm font-medium text-gray-600">Aucun ordre actif — tout est à jour !</p>
                <Button variant="outline" size="sm" onClick={() => goToMyWorkOrders()} data-testid="btn-my-workorders-empty">
                  Voir l'historique
                </Button>
              </div>
            </CardShell>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Urgences */}
            <CardShell>
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center">
                    <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                  </div>
                  <span className="text-sm font-semibold text-gray-800">Urgences du jour</span>
                  {urgentWorkOrders.length > 0 && (
                    <span className="ml-auto rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-700">
                      {urgentWorkOrders.length}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {urgentWorkOrders.length === 0 ? (
                    <p className="text-xs text-gray-400">Aucune intervention prioritaire.</p>
                  ) : (
                    urgentWorkOrders.map((wo) => (
                      <div key={wo.id} className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{wo.title}</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {wo.vehicleRegistrationNumber || "—"} · {translatePriority(wo.priority)}
                            </p>
                          </div>
                          {(wo.priority === "critical" || wo.isOverdue) && (
                            <Badge variant="destructive" className="text-[10px] shrink-0">Urgent</Badge>
                          )}
                        </div>
                        <div className="mt-1.5">
                          <Badge className={cn(getStatusColor(wo.status), "text-[10px]")}>
                            {translateStatus(wo.status)}
                          </Badge>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <Button variant="outline" size="sm" className="w-full mt-3" onClick={() => goToMyWorkOrders()} data-testid="btn-my-workorders">
                  Ouvrir mes ordres de travail
                </Button>
              </div>
            </CardShell>

            {/* Dernières interventions */}
            <CardShell>
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                    <ListChecks className="h-3.5 w-3.5 text-blue-500" />
                  </div>
                  <span className="text-sm font-semibold text-gray-800">Dernières interventions</span>
                </div>
                <div className="space-y-2">
                  {recentWorkOrders.length === 0 ? (
                    <p className="text-xs text-gray-400">Aucune intervention récente.</p>
                  ) : (
                    recentWorkOrders.map((wo) => (
                      <div key={wo.id} className="flex items-start justify-between gap-2 py-2 border-b border-gray-50 last:border-0">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{wo.title}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {wo.vehicleRegistrationNumber || "—"} · {formatDate(getDisplayDate(wo) ?? undefined)}
                          </p>
                        </div>
                        <Badge className={cn(getStatusColor(wo.status), "text-[10px] shrink-0")}>
                          {translateStatus(wo.status)}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </CardShell>
          </div>

          {/* Mes stats + Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Mes statistiques</p>
                <div className="space-y-2">
                  {[
                    { label: "En attente", value: pendingCount, color: "text-yellow-600" },
                    { label: "En cours", value: inProgressCount, color: "text-orange-600" },
                    { label: "Terminés", value: completedCount, color: "text-green-600" },
                    { label: "En retard", value: overdueCount, color: "text-red-600" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                      <span className="text-sm text-gray-500">{label}</span>
                      <span className={`text-sm font-bold ${color}`}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardShell>

            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Actions rapides</p>
                <div className="flex flex-col gap-2">
                  <Button size="sm" className="justify-start gap-2" onClick={() => goToMyWorkOrders()} data-testid="btn-my-workorders">
                    <ClipboardList className="h-3.5 w-3.5" /> Mes ordres de travail
                  </Button>
                  <Button variant="outline" size="sm" className="justify-start gap-2" onClick={() => setLocation("/technician/fleet-status")} data-testid="btn-fleet-status">
                    <Wrench className="h-3.5 w-3.5" /> État de la flotte
                  </Button>
                  <Button variant="outline" size="sm" className="justify-start gap-2" onClick={() => setLocation("/technician/vehicles")} data-testid="btn-vehicles">
                    <Truck className="h-3.5 w-3.5" /> Mes véhicules
                  </Button>
                </div>
              </div>
            </CardShell>
          </div>
        </TabsContent>

        <TabsContent value="fleet" className="space-y-4">
          <KpiGrid columns={3}>
            <KpiTile
              data-testid="tech-kpi-operational"
              label="Véhicules opérationnels"
              value={operationalCount}
              subValue="Disponibles"
              icon={<Truck className="h-4 w-4" />}
              iconWrapperClassName="bg-green-50 text-green-600"
            />
            <KpiTile
              data-testid="tech-kpi-maintenance"
              label="En maintenance"
              value={maintenanceCount}
              subValue="Sous intervention"
              icon={<Wrench className="h-4 w-4" />}
              iconWrapperClassName="bg-orange-50 text-orange-600"
            />
            <KpiTile
              data-testid="tech-kpi-outofservice"
              label="Hors service"
              value={outOfServiceCount}
              subValue="Non disponibles"
              icon={<XCircle className="h-4 w-4" />}
              iconWrapperClassName={outOfServiceCount > 0 ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-400"}
              valueClassName={outOfServiceCount > 0 ? "text-red-600" : undefined}
            />
          </KpiGrid>

          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Accès rapide</p>
              <Button size="sm" className="gap-2" onClick={() => setLocation("/technician/fleet-status")} data-testid="btn-detailed-fleet">
                <ListChecks className="h-3.5 w-3.5" /> Voir l'état détaillé
              </Button>
            </div>
          </CardShell>
        </TabsContent>
      </Tabs>
    </div>
  );
}
