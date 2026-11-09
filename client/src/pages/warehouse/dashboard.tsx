import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { TabIcon } from "@/lib/premium-tab-icons";
import { AlertTriangle, ArrowLeftRight, ArrowRight, CircleDot, ClipboardList, LogOut, Package, Plus, TrendingDown } from "lucide-react";
import { useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PartsConsumptionChart } from "@/components/charts/parts-consumption-chart";
import { StockValueChart } from "@/components/charts/stock-value-chart";
import { OverdueInvoicesAlert } from "@/components/dashboard/overdue-invoices-alert";
import { HeaderCard, KpiGrid, KpiTile, CardShell, AlertBannerCard, PremiumTabsNav } from "@/components/design-system";
import { formatPrice } from "@/lib/utils";
import { useWarehouse } from "@/hooks/useWarehouse";
import { usedTiresLabel } from "@shared/constants/tire-stock";
import { queryView, readyData } from "@/lib/query-view";
import { InlineQueryError } from "@/components/ui/inline-query-error";
import { UNAVAILABLE } from "@/components/dashboard/kpi-tiles";
import { userMessageOf } from "@/lib/api-error";

type StockMovement = {
  movementType?: string | null;
  quantity?: number | null;
  date?: string | null;
  createdAt?: string | null;
};

const ALERT_PIE_COLORS = ["#ef4444", "#f59e0b"];
const MOVEMENT_PIE_COLORS = ["#16a34a", "#dc2626", "#f59e0b", "#2563eb"];

export default function WarehouseDashboard() {
  const [, setLocation] = useLocation();
  const warehouse = useWarehouse();

  // Pneus: le magasinier en est responsable au même titre que les pièces.
  // Deux requêtes légères, suffisantes pour un résumé — le module complet
  // reste sur /inventory/tires.
  // `totalTires` de l'API vaut la somme des quantités malgré son nom: lire
  // `totalReferences` (fiches) et `totalStock` (unités).
  // Une requête en échec sans données affiche « Indisponible » et un encart « Réessayer »,
  // jamais 0 ni « Stock en ordre » (`queryView`, #592).
  const tireStatsQuery = useQuery<{
    totalReferences?: number;
    totalStock?: number;
    /** Pneus usagés remis en stock : hors valeur et hors `totalStock` (neuf). */
    usedQuantity?: number;
    totalValue?: number;
  }>({
    queryKey: ["/api/tires/statistics"],
  });
  const tireStatsView = queryView(tireStatsQuery);

  // Sorties exceptionnelles: pièces parties sans passer par le magasin.
  // Indicateur de gouvernance — la tuile n'apparaît que s'il y en a eu, pour
  // ne pas encombrer un tableau de bord où le cas normal est zéro.
  const { data: warehouseStats } = useQuery<{
    exceptionalIssues?: { total?: number; last30Days?: number };
  }>({
    queryKey: ["/api/warehouse/statistics"],
  });
  const exceptionalTotal = Number(warehouseStats?.exceptionalIssues?.total || 0);
  const exceptional30d = Number(warehouseStats?.exceptionalIssues?.last30Days || 0);

  const lowStockTiresQuery = useQuery<
    Array<{
      id: number;
      brand: string;
      model: string;
      size: string;
      location: string | null;
      stockQuantity: number;
      minStockLevel: number;
    }>
  >({
    queryKey: ["/api/tires/low-stock"],
  });
  const lowStockTiresView = queryView(lowStockTiresQuery);
  const lowStockTiresCount = lowStockTiresView.kind === "ready" ? lowStockTiresView.data.length : 0;
  const stockMovementsQuery = useQuery<StockMovement[]>({
    queryKey: ["/api/parts/stock-movements"],
  });
  // Échec sans données : encart d'erreur dans les graphiques, jamais « Aucun mouvement récent ».
  const stockMovementsView = queryView(stockMovementsQuery);
  const stockMovements = readyData(stockMovementsView, [] as StockMovement[]);
  const stockMovementsLoading = stockMovementsView.kind === "loading";
  const stockMovementsError = stockMovementsView.kind === "error" ? (
    <InlineQueryError
      error={stockMovementsView.error}
      fallback="Les mouvements de stock sont momentanément indisponibles."
      onRetry={() => void stockMovementsQuery.refetch()}
      isRetrying={stockMovementsView.isRetrying}
      data-testid="warehouse-movements-error"
    />
  ) : null;

  const alertSummaryData = useMemo(() => [
    { name: "Rupture", value: warehouse.statistics.data?.outOfStockCount || 0 },
    { name: "Stock bas", value: warehouse.statistics.data?.lowStockCount || 0 },
  ], [warehouse.statistics.data]);

  const shortageTopData = useMemo(() => {
    const parts = (warehouse.reorderAlerts.data as any)?.parts || [];
    return parts
      .filter((p: any) => Number(p.shortage || 0) > 0)
      .sort((a: any, b: any) => Number(b.shortage || 0) - Number(a.shortage || 0))
      .slice(0, 6)
      .map((p: any) => ({ name: String(p.name || "Pièce").slice(0, 18), shortage: Number(p.shortage || 0) }));
  }, [warehouse.reorderAlerts.data]);

  const movements7DaysData = useMemo(() => {
    const days = Array.from({ length: 7 }).map((_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - i));
      return {
        key: date.toISOString().split("T")[0],
        label: date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
        in: 0, out: 0,
      };
    });
    const byDay = new Map(days.map((d) => [d.key, d]));
    stockMovements.forEach((m) => {
      const rawDate = m.date || m.createdAt;
      if (!rawDate) return;
      const bucket = byDay.get(new Date(rawDate).toISOString().split("T")[0]);
      if (!bucket) return;
      const qty = Math.abs(Number(m.quantity || 0));
      if (String(m.movementType || "").toLowerCase() === "out") bucket.out += qty;
      else bucket.in += qty;
    });
    return days;
  }, [stockMovements]);

  const movementTypesData = useMemo(() => {
    const c: Record<string, number> = { in: 0, out: 0, adjustment: 0, initial: 0 };
    stockMovements.forEach((m) => {
      const t = String(m.movementType || "").toLowerCase();
      if (t in c) c[t] += 1;
      else c.adjustment += 1;
    });
    return [
      { name: "Entrées", value: c.in },
      { name: "Sorties", value: c.out },
      { name: "Ajustements", value: c.adjustment },
      { name: "Initial", value: c.initial },
    ].filter((item) => item.value > 0);
  }, [stockMovements]);

  // Valeur du stock en échec : « Indisponible », jamais 0.
  const inventoryValueView = queryView({
    data: warehouse.inventoryValue.data,
    error: warehouse.inventoryValue.error,
    isFetching: warehouse.inventoryValue.isFetching,
  });
  const inventoryValueFailed = inventoryValueView.kind === "error";
  const totalStockValue = Number(readyData(inventoryValueView, undefined)?.totalValue ?? 0);
  const totalPartsCount = Number(warehouse.statistics.data?.totalParts || 0);
  // Unités physiques (somme des quantités), distinct du nombre de références.
  const totalUnitsCount = Number(warehouse.statistics.data?.totalQuantity || 0);
  const lowStockCount = Number(warehouse.statistics.data?.lowStockCount || 0);
  const outOfStockCount = Number(warehouse.statistics.data?.outOfStockCount || 0);
  const reorderAlertsCount = Number((warehouse.reorderAlerts.data as any)?.totalAlerts || 0);
  const alertParts = (warehouse.reorderAlerts.data as any)?.parts || [];
  const reorderData = warehouse.reorderAlerts.data as any;
  const totalShortage = reorderData?.totalShortage || 0;
  const estimatedCost = reorderData?.estimatedCost || 0;
  const otDemandShortage = reorderData?.otDemandShortage || 0;
  const otDemandEstimatedCost = reorderData?.otDemandEstimatedCost || 0;
  const atThreshold = reorderAlertsCount > 0 && totalShortage === 0;

  return (
    <div className="space-y-5">
      <HeaderCard
        title="Gestion du Stock"
        subtitle="Inventaire, mouvements et alertes de réapprovisionnement"
        icon={<Package className="h-5 w-5" />}
      >
        <KpiGrid columns={4}>
          {warehouse.inventoryValue.isLoading ? (
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5"><Skeleton className="h-8 w-8 rounded-lg mb-2" /><Skeleton className="h-3 w-20" /></div>
          ) : (
            <KpiTile
              data-testid="warehouse-kpi-value"
              label="Valeur stock total"
              featured // c'est ce dont le magasinier repond a l'inventaire
              value={inventoryValueFailed ? UNAVAILABLE : formatPrice(totalStockValue)}
              // Le nombre de pièces est déjà la valeur de la tuile suivante:
              // on affiche ici la valeur moyenne, qui n'apparaît nulle part ailleurs.
              // Moyenne par unité physique, cohérent avec la tuile suivante qui
              // compte désormais des unités.
              subValue={
                inventoryValueFailed
                  ? userMessageOf(inventoryValueView.error, "La valeur du stock est momentanément indisponible.")
                  : warehouse.statistics.error
                  ? undefined
                  : totalUnitsCount > 0
                  ? `${formatPrice(Math.round(totalStockValue / totalUnitsCount))} en moyenne par pièce`
                  : "Aucune pièce en stock"
              }
              icon={<Package className="h-4 w-4" />}
              iconWrapperClassName="bg-purple-50 text-purple-600"
            />
          )}
          {warehouse.statistics.isLoading ? (
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5"><Skeleton className="h-8 w-8 rounded-lg mb-2" /><Skeleton className="h-3 w-20" /></div>
          ) : (
            <KpiTile
              data-testid="warehouse-kpi-parts"
              // Le physique d'abord, comme sur l'onglet Pneus: un magasinier qui
              // demande « combien de pièces j'ai » attend le nombre d'unités,
              // pas le nombre de fiches au catalogue.
              label="Pièces en stock"
              value={totalUnitsCount}
              subValue={`${totalPartsCount} pièce${totalPartsCount > 1 ? "s" : ""} différente${totalPartsCount > 1 ? "s" : ""}`}
              icon={<Package className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
            />
          )}
          {warehouse.statistics.isLoading ? (
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5"><Skeleton className="h-8 w-8 rounded-lg mb-2" /><Skeleton className="h-3 w-20" /></div>
          ) : (
            <KpiTile
              data-testid="warehouse-kpi-lowstock"
              label="Stock bas"
              value={lowStockCount}
              subValue={`${outOfStockCount} épuisé(s)`}
              icon={<AlertTriangle className="h-4 w-4" />}
              iconWrapperClassName={(lowStockCount + outOfStockCount) > 0 ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-400"}
              valueClassName={(lowStockCount + outOfStockCount) > 0 ? "text-amber-600" : undefined}
            />
          )}
          {warehouse.reorderAlerts.isLoading ? (
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5"><Skeleton className="h-8 w-8 rounded-lg mb-2" /><Skeleton className="h-3 w-20" /></div>
          ) : (
            <KpiTile
              data-testid="warehouse-kpi-alerts"
              label="Alertes réappro"
              value={reorderAlertsCount}
              subValue={`${totalShortage} unités manquantes`}
              icon={<AlertTriangle className="h-4 w-4" />}
              iconWrapperClassName={reorderAlertsCount > 0 ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-400"}
              valueClassName={reorderAlertsCount > 0 ? "text-red-600" : undefined}
            />
          )}
          {exceptionalTotal > 0 && (
            <KpiTile
              data-testid="warehouse-kpi-exceptional-issues"
              label="Sorties exceptionnelles"
              value={exceptional30d}
              subValue={`sur 30 jours — ${exceptionalTotal} au total`}
              icon={<LogOut className="h-4 w-4" />}
              iconWrapperClassName={exceptional30d > 0 ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-400"}
              valueClassName={exceptional30d > 0 ? "text-amber-600" : undefined}
            />
          )}
        </KpiGrid>
      </HeaderCard>

      <Tabs defaultValue="stock">
        <PremiumTabsNav tabs={[
          { value: "stock", label: "Stock", icon: <TabIcon icon={Package} /> },
          { value: "inventory", label: "Inventaire", icon: <TabIcon icon={ClipboardList} /> },
          { value: "tires", label: "Pneus", icon: <TabIcon icon={CircleDot} /> },
          { value: "alerts", label: "Alertes", icon: <TabIcon icon={AlertTriangle} /> },
          { value: "movements", label: "Mouvements", icon: <TabIcon icon={ArrowLeftRight} /> },
        ]} />

        {/* ── Stock ── */}
        <TabsContent value="stock" className="space-y-4">
          {!warehouse.reorderAlerts.isLoading && alertParts.length === 0 && (
            <AlertBannerCard
              variant="info"
              icon={<Package className="h-4 w-4" />}
              title="Aucune alerte de réapprovisionnement — stock en ordre"
            />
          )}
          {!warehouse.reorderAlerts.isLoading && alertParts.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50/60 px-4 py-3">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <span className="text-sm font-semibold text-red-800">Alertes de réapprovisionnement</span>
                <Badge variant="destructive" className="ml-1 text-[10px]">{alertParts.length}</Badge>
              </div>
              <div className="space-y-2">
                {alertParts.slice(0, 5).map((part: any) => (
                  <div
                    key={part.id}
                    className="flex items-center justify-between bg-white border border-red-100 rounded-lg px-3 py-2 cursor-pointer hover:bg-red-50 transition-colors"
                    onClick={() => setLocation("/inventory/" + part.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <TrendingDown className="h-3.5 w-3.5 text-red-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{part.name}</p>
                        <p className="text-xs text-gray-400">
                          Stock: <span className="font-semibold text-red-600">{part.quantity}</span> / Min: {part.minQuantity}
                          {part.shortage > 0 && <span className="ml-2 text-red-700 font-semibold">— Manque: {part.shortage}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      {part.shortage > 0 ? (
                        <p className="text-xs font-bold text-red-600">{formatPrice(part.unitPrice * part.shortage)}</p>
                      ) : (
                        <Badge variant="outline" className="text-amber-600 border-amber-400 text-[10px]">Au seuil</Badge>
                      )}
                    </div>
                  </div>
                ))}
                {alertParts.length > 5 && (
                  <button className="w-full text-xs text-red-600 hover:underline pt-1" onClick={() => setLocation("/inventory")}>
                    + {alertParts.length - 5} autres alertes — voir l'inventaire
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Actions rapides</p>
                <div className="flex flex-col gap-2">
                  <Link href="/inventory/new">
                    <Button size="sm" className="justify-start gap-2 w-full" data-testid="btn-add-part">
                      <Plus className="h-3.5 w-3.5" /> Ajouter une pièce
                    </Button>
                  </Link>
                  <Link href="/inventory">
                    <Button variant="outline" size="sm" className="justify-start gap-2 w-full" data-testid="btn-view-inventory">
                      <Package className="h-3.5 w-3.5" /> Voir l'inventaire complet
                    </Button>
                  </Link>
                  <Link href="/inventory-requests">
                    <Button variant="outline" size="sm" className="justify-start gap-2 w-full" data-testid="btn-view-requests">
                      <ClipboardList className="h-3.5 w-3.5" /> Demandes de pièces
                    </Button>
                  </Link>
                </div>
              </div>
            </CardShell>

            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Budget réappro (seuil + besoins OT)</p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-1.5 border-b border-gray-50">
                    <span className="text-sm text-gray-500">Coût estimé</span>
                    <span className={`text-sm font-bold ${atThreshold ? "text-amber-600" : estimatedCost > 0 ? "text-red-600" : "text-green-600"}`}>
                      {atThreshold ? "Au seuil" : formatPrice(estimatedCost)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-gray-50">
                    <span className="text-sm text-gray-500">Unités à commander</span>
                    <span className="text-sm font-bold text-gray-800">{totalShortage}</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-gray-50">
                    <span className="text-sm text-gray-500">Dont besoins OT</span>
                    <span className={`text-sm font-bold ${otDemandShortage > 0 ? "text-orange-600" : "text-gray-400"}`}>
                      {otDemandShortage > 0 ? `${otDemandShortage} (${formatPrice(otDemandEstimatedCost)})` : "0"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-gray-500">Alertes actives</span>
                    <span className={`text-sm font-bold ${reorderAlertsCount > 0 ? "text-orange-600" : "text-green-600"}`}>{reorderAlertsCount}</span>
                  </div>
                  {atThreshold && (
                    <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5 mt-1">
                      Les pièces sont au seuil minimum. Surveillez le stock.
                    </p>
                  )}
                </div>
              </div>
            </CardShell>
          </div>

          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Flux de stock — 7 derniers jours</p>
              <p className="text-xs text-gray-400 mb-3">Entrées vs sorties en quantité</p>
              <div className="h-[180px]">
                {stockMovementsLoading ? (
                  <Skeleton className="h-full w-full" />
                ) : stockMovementsError ? (
                  stockMovementsError
                ) : movements7DaysData.some((d) => d.in > 0 || d.out > 0) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={movements7DaysData} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend verticalAlign="top" height={24} />
                      <Bar dataKey="in" name="Entrées" fill="#16a34a" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="out" name="Sorties" fill="#dc2626" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-gray-400">Aucun mouvement sur les 7 derniers jours</div>
                )}
              </div>
            </div>
          </CardShell>

          <OverdueInvoicesAlert />
        </TabsContent>

        {/* ── Inventaire ── */}
        <TabsContent value="inventory" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Top Parts Consumed</p>
                <PartsConsumptionChart />
              </div>
            </CardShell>
            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Stock Value History</p>
                <StockValueChart />
              </div>
            </CardShell>
          </div>
        </TabsContent>

        {/* ── Pneus ──
            Le magasinier gère le catalogue pneus au même titre que les pièces
            (`isTireCatalogManager`), mais son tableau de bord n'en disait rien.
            Cet onglet reste un résumé + point d'entrée: le module complet vit
            sur /inventory/tires, on ne le duplique pas ici. */}
        <TabsContent value="tires" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">
                  Références au catalogue
                </p>
                {tireStatsView.kind === "loading" ? (
                  <Skeleton className="h-7 w-16" />
                ) : tireStatsView.kind === "error" ? (
                  <p className="text-2xl font-bold text-gray-400" data-testid="warehouse-tire-references">{UNAVAILABLE}</p>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-gray-800" data-testid="warehouse-tire-references">
                      {tireStatsView.data.totalReferences ?? 0}
                    </p>
                    <p className="text-[11px] text-gray-400">{tireStatsView.data.totalStock ?? 0} neufs en rayon
                      {(tireStatsView.data.usedQuantity ?? 0) > 0 ? ` + ${usedTiresLabel(tireStatsView.data.usedQuantity ?? 0)}` : ""}
                    </p>
                  </>
                )}
              </div>
            </CardShell>

            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">
                  Valeur du stock pneus
                </p>
                {tireStatsView.kind === "loading" ? (
                  <Skeleton className="h-7 w-28" />
                ) : tireStatsView.kind === "error" ? (
                  <p className="text-2xl font-bold text-gray-400" data-testid="warehouse-tire-value">{UNAVAILABLE}</p>
                ) : (
                  <p className="text-2xl font-bold text-gray-800" data-testid="warehouse-tire-value">
                    {formatPrice(Number(tireStatsView.data.totalValue ?? 0))}
                  </p>
                )}
                <p className="text-[11px] text-gray-400">non incluse dans la valeur stock pièces</p>
              </div>
            </CardShell>

            <CardShell className={lowStockTiresCount > 0 ? "border-orange-200 bg-orange-50/60" : undefined}>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">
                  Sous le seuil
                </p>
                {lowStockTiresView.kind === "loading" ? (
                  <Skeleton className="h-7 w-12" />
                ) : lowStockTiresView.kind === "error" ? (
                  <p className="text-2xl font-bold text-gray-400" data-testid="warehouse-tire-low-stock-count">{UNAVAILABLE}</p>
                ) : (
                  <p
                    className={`text-2xl font-bold ${
                      lowStockTiresCount > 0 ? "text-orange-600" : "text-gray-800"
                    }`}
                    data-testid="warehouse-tire-low-stock-count"
                  >
                    {lowStockTiresCount}
                  </p>
                )}
                <p className="text-[11px] text-gray-400">références à réapprovisionner</p>
              </div>
            </CardShell>
          </div>

          {tireStatsView.kind === "error" ? (
            <InlineQueryError
              error={tireStatsView.error}
              fallback="Les statistiques des pneus sont momentanément indisponibles."
              onRetry={() => void tireStatsQuery.refetch()}
              isRetrying={tireStatsView.isRetrying}
              data-testid="warehouse-tire-stats-error"
            />
          ) : null}

          <CardShell>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400">
                  À réapprovisionner
                </p>
                <p className="text-[11px] text-gray-400">Pneus dont le stock a atteint le seuil d'alerte</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setLocation("/inventory/tires")}>
                Gérer les pneus
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </div>

            <div className="px-5 py-4">
              {lowStockTiresView.kind === "loading" ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : lowStockTiresView.kind === "error" ? (
                <InlineQueryError
                  error={lowStockTiresView.error}
                  fallback="Les pneus sous le seuil sont momentanément indisponibles."
                  onRetry={() => void lowStockTiresQuery.refetch()}
                  isRetrying={lowStockTiresView.isRetrying}
                  data-testid="warehouse-low-stock-tires-error"
                />
              ) : lowStockTiresView.data.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">
                  Aucun pneu sous son seuil. Stock en ordre.
                </p>
              ) : (
                <div className="space-y-2">
                  {lowStockTiresView.data.map((tire) => (
                    <button
                      key={tire.id}
                      type="button"
                      onClick={() => setLocation("/inventory/tires")}
                      className="w-full flex items-center justify-between rounded-xl bg-white border border-orange-200 px-4 py-3 text-left hover:bg-orange-50/60 transition-colors"
                      data-testid={`warehouse-low-stock-tire-${tire.id}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">
                          {tire.brand} {tire.model}
                        </p>
                        <p className="text-[11px] text-gray-400">
                          {tire.size}
                          {tire.location ? ` · ${tire.location}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-orange-300 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
                        {tire.stockQuantity} / {tire.minStockLevel}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </CardShell>
        </TabsContent>

        {/* ── Alertes ── */}
        <TabsContent value="alerts" className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Répartition des alertes</p>
                <p className="text-xs text-gray-400 mb-3">Rupture vs stock bas</p>
                <div className="h-[220px]">
                  {warehouse.statistics.isLoading ? <Skeleton className="h-full w-full" />
                    : alertSummaryData.some((d) => d.value > 0) ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={alertSummaryData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80}>
                            {alertSummaryData.map((entry, i) => (
                              <Cell key={`a-${entry.name}`} fill={ALERT_PIE_COLORS[i % ALERT_PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip /><Legend verticalAlign="bottom" height={30} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-gray-400">Aucune alerte active</div>
                    )}
                </div>
              </div>
            </CardShell>

            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Top pièces à réapprovisionner</p>
                <p className="text-xs text-gray-400 mb-3">Manques les plus critiques</p>
                <div className="h-[220px]">
                  {warehouse.reorderAlerts.isLoading ? <Skeleton className="h-full w-full" />
                    : shortageTopData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={shortageTopData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Bar dataKey="shortage" fill="#ef4444" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-gray-400">Aucun manque détecté</div>
                    )}
                </div>
              </div>
            </CardShell>
          </div>

          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
                Alertes de Réapprovisionnement ({reorderAlertsCount})
              </p>
              {warehouse.reorderAlerts.isLoading ? (
                <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
              ) : alertParts.length > 0 ? (
                <div className="space-y-2">
                  {alertParts.slice(0, 10).map((part: any) => (
                    <div key={part.id} className="flex items-center justify-between p-3 bg-orange-50/80 rounded-xl">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{part.name}</p>
                        <p className="text-xs text-gray-400">
                          Stock: {part.quantity} · Min: {part.minQuantity} · Manque: {part.shortage}
                        </p>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        {part.shortage > 0 ? (
                          <p className="text-sm font-bold text-red-600">{formatPrice(part.unitPrice * part.shortage)}</p>
                        ) : (
                          <Badge variant="outline" className="text-amber-600 border-amber-400 text-[10px]">Au seuil</Badge>
                        )}
                        <p className="text-xs text-gray-400">{part.supplier}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">Aucune alerte de réapprovisionnement</p>
              )}
            </div>
          </CardShell>
        </TabsContent>

        {/* ── Mouvements ── */}
        <TabsContent value="movements" className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Flux stock sur 7 jours</p>
                <p className="text-xs text-gray-400 mb-3">Entrées vs sorties (quantité)</p>
                <div className="h-[220px]">
                  {stockMovementsLoading ? <Skeleton className="h-full w-full" />
                    : stockMovementsError ? stockMovementsError
                    : movements7DaysData.some((d) => d.in > 0 || d.out > 0) ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={movements7DaysData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} />
                          <Tooltip /><Legend verticalAlign="top" height={26} />
                          <Bar dataKey="in" name="Entrées" fill="#16a34a" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="out" name="Sorties" fill="#dc2626" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : <div className="h-full flex items-center justify-center text-xs text-gray-400">Aucun mouvement récent</div>}
                </div>
              </div>
            </CardShell>

            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Types de mouvements</p>
                <p className="text-xs text-gray-400 mb-3">Répartition des opérations enregistrées</p>
                <div className="h-[220px]">
                  {stockMovementsLoading ? <Skeleton className="h-full w-full" />
                    : stockMovementsError ? stockMovementsError
                    : movementTypesData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={movementTypesData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={78}>
                            {movementTypesData.map((entry, i) => (
                              <Cell key={`m-${entry.name}`} fill={MOVEMENT_PIE_COLORS[i % MOVEMENT_PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip /><Legend verticalAlign="bottom" height={30} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <div className="h-full flex items-center justify-center text-xs text-gray-400">Aucun mouvement à analyser</div>}
                </div>
              </div>
            </CardShell>
          </div>

          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Mouvements de Stock</p>
              <p className="text-sm text-gray-500 mb-3">Gérez les entrées et sorties de pièces du magasin</p>
              <div className="flex gap-2">
                <Link href="/inventory">
                  <Button size="sm" className="gap-2 bg-green-600 hover:bg-green-700" data-testid="btn-stock-entry">
                    <Plus className="h-3.5 w-3.5" /> Entrée de stock
                  </Button>
                </Link>
                <Link href="/inventory">
                  <Button size="sm" className="gap-2 bg-red-600 hover:bg-red-700 text-white" data-testid="btn-stock-exit">
                    <LogOut className="h-3.5 w-3.5" /> Sortie de stock
                  </Button>
                </Link>
              </div>
            </div>
          </CardShell>
        </TabsContent>
      </Tabs>
    </div>
  );
}
