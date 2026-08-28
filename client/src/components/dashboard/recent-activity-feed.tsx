import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import {
  Activity, Wrench, Truck, Package,
  ArrowDownCircle, ArrowUpCircle, RefreshCw,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

const WO_STATUS: Record<string, { label: string; color: string }> = {
  pending:        { label: 'En attente',      color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  in_progress:    { label: 'En cours',        color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  awaiting_parts: { label: 'Attente pièces',  color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  completed:      { label: 'Terminé',         color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  cancelled:      { label: 'Annulé',          color: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400' },
};

const MISSION_STATUS: Record<string, { label: string; color: string }> = {
  draft:       { label: 'Brouillon',  color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400' },
  planned:     { label: 'Planifiée', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  assigned:    { label: 'Assignée',  color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' },
  in_progress: { label: 'En cours',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  delivered:   { label: 'Livrée',    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  completed:   { label: 'Complétée', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  cancelled:   { label: 'Annulée',   color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

function RelativeTime({ date }: { date: string | Date | undefined }) {
  if (!date) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="text-xs text-muted-foreground hidden sm:block">
      {formatDistanceToNow(new Date(date), { addSuffix: true, locale: fr })}
    </span>
  );
}

function StatusBadge({ config }: { config: { label: string; color: string } | undefined }) {
  const { label, color } = config ?? { label: '—', color: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

function ItemSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground text-center py-8">{text}</p>;
}

export function RecentActivityFeed() {
  const [, setLocation] = useLocation();

  const { data: woData, isLoading: woLoading } = useQuery<any>({
    queryKey: ["/api/work-orders", { limit: 5 }],
  });

  const { data: missions = [], isLoading: missionsLoading } = useQuery<any[]>({
    queryKey: ["/api/operations/missions"],
  });

  const { data: movements = [], isLoading: movementsLoading } = useQuery<any[]>({
    queryKey: ["/api/parts/stock-movements"],
  });

  const workOrders: any[] = woData?.workOrders?.slice(0, 5) ?? [];

  const recentMissions = [...missions]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const recentMovements = [...movements]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Activité récente
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs defaultValue="workorders" className="w-full">
          <TabsList className="w-full rounded-none border-b bg-transparent h-9 px-4 justify-start gap-1">
            <TabsTrigger value="workorders" className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-9 gap-1">
              <Wrench className="h-3 w-3" /> Ordres de travail
            </TabsTrigger>
            <TabsTrigger value="missions" className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-9 gap-1">
              <Truck className="h-3 w-3" /> Missions
            </TabsTrigger>
            <TabsTrigger value="stock" className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-9 gap-1">
              <Package className="h-3 w-3" /> Mouvements stock
            </TabsTrigger>
          </TabsList>

          {/* Work Orders */}
          <TabsContent value="workorders" className="mt-0">
            {woLoading ? <ItemSkeleton /> : workOrders.length === 0 ? (
              <EmptyState text="Aucun ordre de travail récent" />
            ) : (
              <div className="divide-y">
                {workOrders.map((wo: any) => (
                  <div key={wo.id} className="flex items-center justify-between px-6 py-3 hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                        <Wrench className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{wo.title}</p>
                        <p className="text-xs text-muted-foreground">{wo.vehicleRegistration ?? '—'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <StatusBadge config={WO_STATUS[wo.status]} />
                      <RelativeTime date={wo.createdAt} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="px-6 py-3 border-t">
              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => setLocation('/maintenance/work-orders')}>
                Voir tous les ordres de travail <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </TabsContent>

          {/* Missions */}
          <TabsContent value="missions" className="mt-0">
            {missionsLoading ? <ItemSkeleton /> : recentMissions.length === 0 ? (
              <EmptyState text="Aucune mission récente" />
            ) : (
              <div className="divide-y">
                {recentMissions.map((mission: any) => (
                  <div key={mission.id} className="flex items-center justify-between px-6 py-3 hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                        <Truck className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{mission.orderNumber}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {mission.client?.name ?? mission.deliveryAddress ?? '—'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <StatusBadge config={MISSION_STATUS[mission.status]} />
                      <RelativeTime date={mission.createdAt} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="px-6 py-3 border-t">
              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => setLocation('/operations/missions')}>
                Voir toutes les missions <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </TabsContent>

          {/* Stock movements */}
          <TabsContent value="stock" className="mt-0">
            {movementsLoading ? <ItemSkeleton /> : recentMovements.length === 0 ? (
              <EmptyState text="Aucun mouvement de stock récent" />
            ) : (
              <div className="divide-y">
                {recentMovements.map((mv: any) => {
                  const isIn = mv.movementType === 'in' || mv.movementType === 'initial';
                  const isOut = mv.movementType === 'out';
                  return (
                    <div key={mv.id} className="flex items-center justify-between px-6 py-3 hover:bg-muted/40 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${isIn ? 'bg-green-100 dark:bg-green-900/30' : isOut ? 'bg-red-100 dark:bg-red-900/30' : 'bg-blue-100 dark:bg-blue-900/30'}`}>
                          {isIn
                            ? <ArrowDownCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                            : isOut
                              ? <ArrowUpCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                              : <RefreshCw className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{mv.reason ?? mv.movementType}</p>
                          <p className={`text-xs font-semibold ${isIn ? 'text-green-600 dark:text-green-400' : isOut ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
                            {isOut ? '−' : '+'}{mv.quantity} unité{mv.quantity > 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                      <RelativeTime date={mv.createdAt} />
                    </div>
                  );
                })}
              </div>
            )}
            <div className="px-6 py-3 border-t">
              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => setLocation('/warehouse')}>
                Voir les mouvements <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
