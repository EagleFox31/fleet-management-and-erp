import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice } from "@/lib/utils";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DollarSign,
  FileText,
  PieChart as PieChartIcon,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import {
  CardShell,
  KpiGrid,
  KpiTile,
  PremiumDataTable,
  SectionLabel,
  type PremiumDataTableColumn,
} from "@/components/design-system";

interface BillingStatistics {
  totalInvoices: number;
  totalAmountHT: number;
  totalAmountTTC: number;
  totalPaid: number;
  totalBalance: number;
  byStatus: {
    status: string;
    count: number;
    totalAmountTTC: number | string;
    totalBalance: number | string;
  }[];
  byClient: {
    clientName: string;
    totalInvoices: number;
    totalAmountTTC: number | string;
    totalPaid: number | string;
    totalBalance: number | string;
  }[];
  recentInvoices?: any[];
}

type BillingStatus = "pending" | "partial" | "paid" | "overdue";

interface StatusMetric {
  key: BillingStatus;
  label: string;
  count: number;
  amount: number;
  balance: number;
  textClassName: string;
  bgClassName: string;
  chipClassName: string;
  chartColor: string;
}

interface ClientRow {
  clientName: string;
  totalInvoices: number;
  totalAmountTTC: number;
  totalPaid: number;
  totalBalance: number;
  collectionRate: number;
}

const STATUS_ORDER: BillingStatus[] = ["pending", "partial", "paid", "overdue"];

const STATUS_META: Record<
  BillingStatus,
  {
    label: string;
    textClassName: string;
    bgClassName: string;
    chipClassName: string;
    chartColor: string;
  }
> = {
  pending: {
    label: "En attente",
    textClassName: "text-amber-700",
    bgClassName: "bg-amber-50 border-amber-100",
    chipClassName: "bg-amber-50 border-amber-200 text-amber-700",
    chartColor: "#F59E0B",
  },
  partial: {
    label: "Partielle",
    textClassName: "text-sky-700",
    bgClassName: "bg-sky-50 border-sky-100",
    chipClassName: "bg-sky-50 border-sky-200 text-sky-700",
    chartColor: "#0EA5E9",
  },
  paid: {
    label: "Payée",
    textClassName: "text-emerald-700",
    bgClassName: "bg-emerald-50 border-emerald-100",
    chipClassName: "bg-emerald-50 border-emerald-200 text-emerald-700",
    chartColor: "#10B981",
  },
  overdue: {
    label: "En retard",
    textClassName: "text-rose-700",
    bgClassName: "bg-rose-50 border-rose-100",
    chipClassName: "bg-rose-50 border-rose-200 text-rose-700",
    chartColor: "#EF4444",
  },
};

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function getCollectionRateClass(rate: number): string {
  if (rate >= 80) {
    return "text-emerald-700";
  }
  if (rate >= 50) {
    return "text-amber-700";
  }
  return "text-rose-700";
}

export function InvoicingDashboard() {
  const liveQueryConfig = {
    staleTime: 30_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  } as const;

  const { data: stats, isLoading } = useQuery<BillingStatistics>({
    queryKey: ["/api/billing/statistics"],
    ...liveQueryConfig,
  });

  const clientRows = useMemo<ClientRow[]>(() => {
    if (!stats) {
      return [];
    }

    return (stats.byClient || [])
      .map((client) => {
        const totalAmountTTC = toNumber(client.totalAmountTTC);
        const totalPaid = toNumber(client.totalPaid);
        const totalBalance = toNumber(client.totalBalance);
        const collectionRate =
          totalAmountTTC > 0 ? (totalPaid / totalAmountTTC) * 100 : 0;

        return {
          clientName: client.clientName || "Client sans nom",
          totalInvoices: Number(client.totalInvoices || 0),
          totalAmountTTC,
          totalPaid,
          totalBalance,
          collectionRate,
        };
      })
      .sort((a, b) => b.totalAmountTTC - a.totalAmountTTC);
  }, [stats]);

  const statusMetrics = useMemo<StatusMetric[]>(() => {
    if (!stats) {
      return STATUS_ORDER.map((status) => ({
        key: status,
        label: STATUS_META[status].label,
        count: 0,
        amount: 0,
        balance: 0,
        textClassName: STATUS_META[status].textClassName,
        bgClassName: STATUS_META[status].bgClassName,
        chipClassName: STATUS_META[status].chipClassName,
        chartColor: STATUS_META[status].chartColor,
      }));
    }

    const byStatusMap = new Map(
      (stats.byStatus || []).map((item) => [item.status, item]),
    );

    return STATUS_ORDER.map((status) => {
      const item = byStatusMap.get(status);
      const meta = STATUS_META[status];
      return {
        key: status,
        label: meta.label,
        count: Number(item?.count || 0),
        amount: toNumber(item?.totalAmountTTC),
        balance: toNumber(item?.totalBalance),
        textClassName: meta.textClassName,
        bgClassName: meta.bgClassName,
        chipClassName: meta.chipClassName,
        chartColor: meta.chartColor,
      };
    });
  }, [stats]);

  const statusChartData = useMemo(
    () =>
      statusMetrics
        .filter((item) => item.count > 0 || item.amount > 0 || item.balance > 0)
        .map((item) => ({
          name: item.label,
          count: item.count,
          amount: item.amount,
          balance: item.balance,
          fill: item.chartColor,
        })),
    [statusMetrics],
  );

  const topClientsChartData = useMemo(
    () =>
      clientRows.slice(0, 6).map((client) => ({
        name:
          client.clientName.length > 18
            ? `${client.clientName.slice(0, 18)}…`
            : client.clientName,
        total: client.totalAmountTTC,
        paid: client.totalPaid,
        balance: client.totalBalance,
      })),
    [clientRows],
  );

  const collectionRate =
    stats && stats.totalAmountTTC > 0
      ? (stats.totalPaid / stats.totalAmountTTC) * 100
      : 0;

  const collectionPieData = [
    {
      name: "Encaissé",
      value: stats?.totalPaid ?? 0,
      fill: "#10B981",
    },
    {
      name: "Reste à encaisser",
      value: stats?.totalBalance ?? 0,
      fill: "#E5E7EB",
    },
  ];

  const tableColumns: PremiumDataTableColumn<ClientRow>[] = [
    {
      id: "client",
      header: "Client",
      widthClassName: "w-[280px]",
      cell: (row) => (
        <div className="space-y-1">
          <p className="font-semibold text-gray-900">{row.clientName}</p>
          <p className="text-xs text-gray-500">{row.totalInvoices} facture(s)</p>
        </div>
      ),
    },
    {
      id: "amount",
      header: "Montant TTC",
      align: "right",
      widthClassName: "w-[170px]",
      cell: (row) => (
        <span className="font-semibold text-gray-900">{formatPrice(row.totalAmountTTC)}</span>
      ),
    },
    {
      id: "paid",
      header: "Encaissé",
      align: "right",
      widthClassName: "w-[170px]",
      cell: (row) => (
        <span className="font-semibold text-emerald-700">{formatPrice(row.totalPaid)}</span>
      ),
    },
    {
      id: "balance",
      header: "Reste",
      align: "right",
      widthClassName: "w-[170px]",
      cell: (row) => (
        <span className="font-semibold text-amber-700">{formatPrice(row.totalBalance)}</span>
      ),
    },
    {
      id: "rate",
      header: "Recouvrement",
      align: "right",
      widthClassName: "w-[150px]",
      cell: (row) => (
        <span className={`font-semibold ${getCollectionRateClass(row.collectionRate)}`}>
          {formatPercent(row.collectionRate)}
        </span>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="space-y-5">
        <CardShell topBar>
          <div className="px-5 py-4 border-b border-gray-100">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-4 w-80 mt-2" />
          </div>
          <div className="px-5 py-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <Skeleton className="h-[108px] w-full rounded-xl" />
            <Skeleton className="h-[108px] w-full rounded-xl" />
            <Skeleton className="h-[108px] w-full rounded-xl" />
            <Skeleton className="h-[108px] w-full rounded-xl" />
          </div>
        </CardShell>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <Skeleton className="h-[360px] w-full rounded-2xl" />
          <Skeleton className="h-[360px] w-full rounded-2xl xl:col-span-2" />
        </div>

        <Skeleton className="h-[360px] w-full rounded-2xl" />
      </div>
    );
  }

  if (!stats) {
    return (
      <CardShell>
        <div className="px-5 py-16 text-center">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-base font-medium text-gray-600">Aucune donnée disponible</p>
          <p className="text-sm text-gray-400 mt-1">Les indicateurs de facturation seront affichés ici.</p>
        </div>
      </CardShell>
    );
  }

  return (
    <div className="space-y-5">
      <CardShell topBar>
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionLabel className="text-emerald-600">Facturation clients</SectionLabel>
            <h2 className="text-lg font-semibold text-gray-900 mt-1">Vue financière</h2>
            <p className="text-sm text-gray-500 mt-1">
              Suivi des encaissements, retards et exposition client.
            </p>
          </div>
          <Link href="/operations/invoices">
            <Button variant="outline" size="sm" className="h-9">
              Voir les factures
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </Link>
        </div>

        <div className="px-5 py-5">
          <KpiGrid columns={4} withTopBorder={false}>
            <KpiTile
              label="Total factures"
              value={stats.totalInvoices}
              subValue="Toutes périodes"
              icon={<FileText className="h-4 w-4" />}
              iconWrapperClassName="bg-sky-50 text-sky-700"
            />
            <KpiTile
              label="Montant TTC"
              value={formatPrice(stats.totalAmountTTC)}
              subValue={`HT: ${formatPrice(stats.totalAmountHT)}`}
              icon={<DollarSign className="h-4 w-4" />}
              iconWrapperClassName="bg-emerald-50 text-emerald-700"
              valueClassName="text-emerald-700"
            />
            <KpiTile
              label="Encaissé"
              value={formatPrice(stats.totalPaid)}
              subValue={`Taux: ${formatPercent(collectionRate)}`}
              icon={<CheckCircle2 className="h-4 w-4" />}
              iconWrapperClassName="bg-teal-50 text-teal-700"
              valueClassName="text-teal-700"
            />
            <KpiTile
              label="Reste à encaisser"
              value={formatPrice(stats.totalBalance)}
              subValue="Créances ouvertes"
              icon={<AlertTriangle className="h-4 w-4" />}
              iconWrapperClassName="bg-amber-50 text-amber-700"
              valueClassName="text-amber-700"
            />
          </KpiGrid>
        </div>
      </CardShell>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <CardShell className="xl:col-span-1">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
            <div>
              <SectionLabel>Statuts de factures</SectionLabel>
              <h3 className="text-base font-semibold text-gray-900 mt-1">Répartition</h3>
            </div>
            <PieChartIcon className="h-4 w-4 text-gray-400" />
          </div>

          <div className="px-5 pt-4 pb-1">
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie
                  data={collectionPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={78}
                  stroke="none"
                >
                  {collectionPieData.map((item) => (
                    <Cell key={item.name} fill={item.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: any) => formatPrice(toNumber(value))} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="px-5 pb-5 space-y-2">
            {statusMetrics.map((status) => (
              <div
                key={status.key}
                className={`rounded-xl border px-3 py-2.5 flex items-center justify-between ${status.bgClassName}`}
              >
                <div>
                  <p className={`text-sm font-semibold ${status.textClassName}`}>{status.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{formatPrice(status.amount)}</p>
                </div>
                <Badge variant="outline" className={`font-semibold ${status.chipClassName}`}>
                  {status.count}
                </Badge>
              </div>
            ))}
          </div>
        </CardShell>

        <CardShell className="xl:col-span-2">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
            <div>
              <SectionLabel>Top clients</SectionLabel>
              <h3 className="text-base font-semibold text-gray-900 mt-1">Facturé vs encaissé</h3>
            </div>
            <TrendingUp className="h-4 w-4 text-gray-400" />
          </div>

          <div className="px-3 py-4">
            {topClientsChartData.length === 0 ? (
              <div className="h-[290px] flex items-center justify-center text-sm text-gray-400">
                Aucune donnée client à afficher.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={290}>
                <BarChart data={topClientsChartData} barGap={8}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#EEF1F4" vertical={false} />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#6B7280", fontSize: 11 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#9CA3AF", fontSize: 11 }}
                    tickFormatter={(value) => `${(toNumber(value) / 1_000_000).toFixed(1)}M`}
                  />
                  <Tooltip
                    formatter={(value: any) => formatPrice(toNumber(value))}
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid #E5E7EB",
                      boxShadow: "0 8px 26px rgba(15, 23, 42, 0.08)",
                    }}
                  />
                  <Bar dataKey="total" name="Facturé" fill="#0EA5E9" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="paid" name="Encaissé" fill="#10B981" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="balance" name="Reste" fill="#F59E0B" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardShell>
      </div>

      <PremiumDataTable
        columns={tableColumns}
        rows={clientRows}
        rowKey={(row) => row.clientName}
        tableClassName="min-w-[980px]"
        rowClassName={(_, index) => (index % 2 === 1 ? "bg-slate-50/65" : "bg-white")}
        toolbar={
          <div className="w-full flex items-center justify-between gap-3">
            <div>
              <SectionLabel>Détails clients</SectionLabel>
              <h3 className="text-base font-semibold text-gray-900 mt-1">Tableau de recouvrement</h3>
            </div>
            <Badge variant="secondary" className="bg-gray-100 text-gray-700 border border-gray-200">
              <Clock3 className="h-3.5 w-3.5 mr-1" />
              {clientRows.length} client(s)
            </Badge>
          </div>
        }
        emptyState={
          <div className="space-y-1">
            <p className="text-sm text-gray-500">Aucune facture client disponible.</p>
            <p className="text-xs text-gray-400">Créez des factures pour afficher la vue de recouvrement.</p>
          </div>
        }
        footer={
          <div className="w-full flex items-center justify-between gap-3 text-xs text-gray-500">
            <span>Total factures: {stats.totalInvoices}</span>
            <span>
              Encaissé: {formatPrice(stats.totalPaid)} / Reste: {formatPrice(stats.totalBalance)}
            </span>
          </div>
        }
      />
    </div>
  );
}
