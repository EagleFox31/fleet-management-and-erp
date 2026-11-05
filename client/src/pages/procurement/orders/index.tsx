import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Package,
  Plus,
  FileText,
  TrendingUp,
  Calendar,
  CheckCircle,
  XCircle,
  Clock,
  Truck,
  HelpCircle,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ProcurementTutorialModal } from "@/components/procurement/procurement-tutorial-modal";
import { formatPrice } from "@/lib/utils";

interface PurchaseOrder {
  id: number;
  orderNumber: string;
  supplierId: number;
  orderDate: string;
  expectedDeliveryDate: string | null;
  status: string;
  totalAmountHT: string;
  totalAmountTTC: string;
  discountPercentage: string;
  urgency: string;
  createdAt: string;
  supplier?: { id: number; name: string };
  creator?: { id: number; name: string };
  linesCount: number;
}

interface OrderStatistics {
  totalOrders: number;
  totalAmount: number;
  totalSavings: number;
  averageDiscount: number;
  ordersByStatus: Record<string, number>;
}

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: "Brouillon", color: "bg-gray-100 text-gray-600", icon: FileText },
  sent: { label: "Envoyée", color: "bg-blue-100 text-blue-700", icon: CheckCircle },
  confirmed: { label: "Confirmée", color: "bg-green-100 text-green-700", icon: CheckCircle },
  cancellation_requested: { label: "Annulation demandée", color: "bg-orange-100 text-orange-700", icon: XCircle },
  partial: { label: "Partielle", color: "bg-yellow-100 text-yellow-700", icon: Clock },
  delivered: { label: "Livrée", color: "bg-indigo-100 text-indigo-700", icon: Truck },
  completed: { label: "Terminée", color: "bg-emerald-100 text-emerald-700", icon: CheckCircle },
  cancelled: { label: "Annulée", color: "bg-red-100 text-red-700", icon: XCircle },
};

const urgencyBorderMap: Record<string, string> = {
  critical: "border-l-red-500",
  high: "border-l-orange-400",
  medium: "border-l-yellow-400",
  low: "border-l-blue-200",
};

export default function PurchaseOrdersListPage() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [, setLocation] = useLocation();

  const { data: orders = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/purchase-orders", { status: statusFilter }],
  });

  const { data: stats } = useQuery<OrderStatistics>({
    queryKey: ["/api/purchase-orders/statistics"],
  });

  const filteredOrders = orders.filter(order => {
    const matchesSearch = !searchQuery ||
      order.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.supplier?.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const formatCurrency = (amount: string | number) => formatPrice(Number(amount));

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white">
        <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
        <div className="px-5 py-5 md:px-7 md:py-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center shrink-0">
                <Package className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-widest text-green-600">Approvisionnement</span>
                <h1 className="text-xl font-bold text-gray-900 leading-tight">Commandes d'Achat</h1>
                <p className="text-sm text-gray-400 mt-0.5">Gestion des commandes groupées et optimisation des coûts</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" data-testid="button-tutorial" onClick={() => setTutorialOpen(true)}
                className="border-gray-200 text-gray-600 hover:bg-gray-50 gap-1.5">
                <HelpCircle className="h-3.5 w-3.5" />Guide
              </Button>
              <Link href="/procurement/orders/group">
                <Button variant="outline" size="sm" data-testid="button-group-suggestions"
                  className="border-gray-200 text-gray-600 hover:bg-gray-50 gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" />Regroupement Auto
                </Button>
              </Link>
              <Link href="/procurement/orders/new">
                <Button size="sm" data-testid="button-new-order" className="bg-green-600 hover:bg-green-700 text-white gap-1.5">
                  <Plus className="h-3.5 w-3.5" />Nouvelle Commande
                </Button>
              </Link>
            </div>
          </div>

          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-gray-100">
              {[
                { icon: <Package className="h-4 w-4 text-green-600" />, iconBg: "bg-green-50", label: "Total Commandes", value: String(stats.totalOrders), sub: "toutes périodes", testId: "stat-total-orders" },
                { icon: <FileText className="h-4 w-4 text-blue-500" />, iconBg: "bg-blue-50", label: "Montant Total", value: formatCurrency(stats.totalAmount), sub: "toutes taxes comprises", testId: "stat-total-amount" },
                { icon: <TrendingUp className="h-4 w-4 text-emerald-500" />, iconBg: "bg-emerald-50", label: "Économies", value: formatCurrency(stats.totalSavings), sub: `Remise moy. ${stats.averageDiscount.toFixed(1)}%`, testId: "stat-savings" },
                { icon: <Clock className="h-4 w-4 text-amber-500" />, iconBg: "bg-amber-50", label: "À traiter", value: String((stats.ordersByStatus.draft || 0) + (stats.ordersByStatus.sent || 0) + (stats.ordersByStatus.cancellation_requested || 0)), sub: "prépa + envoi + annulation", testId: "stat-pending" },
              ].map((kpi) => (
                <div key={kpi.label} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-2">
                  <div className={`w-8 h-8 rounded-lg ${kpi.iconBg} flex items-center justify-center`}>{kpi.icon}</div>
                  <div className="leading-tight">
                    <p className="text-[11px] font-medium text-gray-500">{kpi.label}</p>
                    <p className="text-xl font-bold text-gray-800 leading-none mt-1" data-testid={kpi.testId}>{kpi.value}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{kpi.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Orders table card ── */}
      <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <input
              type="text"
              className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-100 rounded-lg outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400 transition-all placeholder:text-gray-400"
              placeholder="Rechercher par numéro ou fournisseur..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-search"
            />
          </div>
          <Select value={statusFilter || "all"} onValueChange={(value) => setStatusFilter(value === "all" ? "" : value)}>
            <SelectTrigger className="w-[180px] text-sm h-9 border-gray-100 bg-gray-50" data-testid="select-status-filter">
              <SelectValue placeholder="Tous les statuts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              <SelectItem value="draft">Brouillon</SelectItem>
              <SelectItem value="sent">Envoyée</SelectItem>
              <SelectItem value="confirmed">Confirmée</SelectItem>
              <SelectItem value="cancellation_requested">Annulation demandée</SelectItem>
              <SelectItem value="partial">Partielle</SelectItem>
              <SelectItem value="delivered">Livrée</SelectItem>
              <SelectItem value="completed">Terminée</SelectItem>
              <SelectItem value="cancelled">Annulée</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-gray-400 ml-auto">
            {filteredOrders.length} commande{filteredOrders.length > 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {["N° Commande", "Fournisseur", "Date", "Montant TTC", "Lignes", "Statut"].map((h, i) => (
                  <th key={i} className={`px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-400 whitespace-nowrap text-left`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3.5">
                        <Skeleton className="h-4 w-full max-w-[120px] rounded-md" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <Package className="h-9 w-9 opacity-30" />
                      <p className="text-sm font-medium">Aucune commande trouvée</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const statusInfo = statusConfig[order.status] || statusConfig.draft;
                  const StatusIcon = statusInfo.icon;
                  const urgencyBorder = urgencyBorderMap[order.urgency] || "border-l-transparent";

                  return (
                    <tr
                      key={order.id}
                      onClick={() => setLocation(`/procurement/orders/${order.id}`)}
                      className={`group cursor-pointer border-b border-gray-50 last:border-0 transition-colors hover:bg-gray-50/60 border-l-2 ${urgencyBorder}`}
                      data-testid={`order-${order.id}`}
                    >
                      {/* N° Commande */}
                      <td className="px-4 py-3.5">
                        {/* Ligne cliquable = détail (AGENTS §5) ; le numéro reste un lien pour le clavier. */}
                        <Link
                          href={`/procurement/orders/${order.id}`}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Voir la commande ${order.orderNumber}`}
                          className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-mono font-semibold text-gray-600 whitespace-nowrap hover:bg-blue-50 hover:text-blue-700"
                          data-testid={`order-number-${order.id}`}
                        >
                          {order.orderNumber}
                        </Link>
                      </td>

                      {/* Fournisseur */}
                      <td className="px-4 py-3.5">
                        <span className="text-sm font-medium text-gray-700" data-testid={`order-supplier-${order.id}`}>
                          {order.supplier?.name || "—"}
                        </span>
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3.5">
                        <span className="text-sm text-gray-500 whitespace-nowrap flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-gray-400" />
                          {formatDate(order.orderDate)}
                        </span>
                      </td>

                      {/* Montant TTC */}
                      <td className="px-4 py-3.5">
                        <span className="text-sm font-bold text-gray-800 tabular-nums" data-testid={`order-amount-${order.id}`}>
                          {formatCurrency(order.totalAmountTTC)}
                        </span>
                      </td>

                      {/* Lignes + Remise */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm text-gray-500">
                            {order.linesCount} art.
                          </span>
                          {Number(order.discountPercentage) > 0 && (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700 whitespace-nowrap">
                              -{Number(order.discountPercentage).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Statut */}
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${statusInfo.color}`}>
                          <StatusIcon className="h-3 w-3" />
                          {statusInfo.label}
                        </span>
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ProcurementTutorialModal open={tutorialOpen} onOpenChange={setTutorialOpen} />
    </div>
  );
}
