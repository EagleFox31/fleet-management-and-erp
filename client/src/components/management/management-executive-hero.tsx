import { useState } from "react";
import { Link } from "wouter";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  Clock,
  DollarSign,
  Download,
  FileText,
  LayoutDashboard,
  Percent,
  Receipt,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Truck,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ManagementPeriodSelector } from "@/components/management/management-period-selector";
import { ManagementDashboardInfoTip } from "@/components/management/management-dashboard-info-tip";
import { formatPrice } from "@/lib/utils";
import { formatManagementGreeting } from "@/lib/management-greeting";
import { exportManagementBoardPackPdf } from "@/lib/management-board-pack-pdf";
import type {
  ManagementDashboardResponse,
  ManagementPeriod,
} from "@shared/constants/management-dashboard";

type ManagementExecutiveHeroProps = {
  data: ManagementDashboardResponse;
  period: ManagementPeriod;
  onPeriodChange: (period: ManagementPeriod) => void;
  userName?: string;
};

function ExecutiveTrendBadge({
  percent,
  higherIsBetter = true,
  periodLabel,
}: {
  percent: number | null;
  higherIsBetter?: boolean;
  periodLabel: string;
}) {
  if (percent == null || isNaN(percent)) return null;

  const isPositive = percent > 0;
  const isNeutral = Math.abs(percent) < 0.1;
  const isFavorable = higherIsBetter ? isPositive : !isPositive;

  const badgeStyles = isNeutral
    ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
    : isFavorable
    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25"
    : "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/25";

  const Icon = isNeutral ? null : isPositive ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${badgeStyles}`}
      >
        {Icon && <Icon className="h-3 w-3" />}
        {percent > 0 ? `+${percent.toFixed(1)}%` : `${percent.toFixed(1)}%`}
      </span>
      <span className="text-[10px] text-muted-foreground">vs {periodLabel.toLowerCase()}</span>
    </div>
  );
}

export function ManagementExecutiveHero({
  data,
  period,
  onPeriodChange,
  userName,
}: ManagementExecutiveHeroProps) {
  const { revenue, expenses, result, trends, alerts } = data;
  const collectionRate = revenue.invoicedTTC > 0 ? (revenue.collectedTTC / revenue.invoicedTTC) * 100 : 0;

  const hasAlerts =
    alerts.overdueInvoices > 0 ||
    alerts.outOfServiceVehicles > 0 ||
    alerts.vehiclesImmobilizedOver48h > 0;

  return (
    <div className="space-y-4">
      {/* 1. Header Bar Aérien et Exécutif (Thème Clair Lumineux) */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden">
        <div className="space-y-1 relative z-10">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800 uppercase tracking-wider">
              <Sparkles className="h-3 w-3" /> Direction Générale
            </span>
            <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            <span className="text-xs text-muted-foreground font-medium">Yaro FleetOS</span>
          </div>

          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
            {userName ? formatManagementGreeting(userName) : "Tableau de bord Direction"}
          </h1>
          <p className="text-xs text-muted-foreground">
            Supervision stratégique des revenus d'exploitation, charges directes et marge nette.
          </p>
        </div>

        {/* Contrôles de Période & Export PDF */}
        <div className="flex flex-wrap items-center gap-2.5 relative z-10">
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/80 p-1 rounded-2xl border border-slate-200/80 dark:border-slate-700">
            <ManagementPeriodSelector value={period} onChange={onPeriodChange} />
            <ManagementDashboardInfoTip
              periodStart={data.periodStart}
              periodEnd={data.periodEnd}
              previousPeriodStart={data.previousPeriodStart}
              previousPeriodEnd={data.previousPeriodEnd}
            />
          </div>

          <Button
            type="button"
            size="sm"
            onClick={() => exportManagementBoardPackPdf(data)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="h-4 w-4" />
            Export PDF
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            asChild
            className="rounded-xl border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Link href="/management/reports">
              <FileText className="mr-1.5 h-4 w-4 text-slate-500" />
              Rapports
            </Link>
          </Button>
        </div>
      </div>

      {/* 2. Quatuor de KPI Exécutifs en Format Bento Hero */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Tuile 1 : CA Facturé (TTC) */}
        <div className="p-5 rounded-3xl bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent border border-blue-500/20 dark:border-blue-900/40 shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-900 dark:text-blue-300 uppercase tracking-wider flex items-center gap-1.5">
              <Receipt className="h-3.5 w-3.5 text-blue-600" /> CA Facturé (TTC)
            </span>
            <div className="p-2 rounded-xl bg-blue-500/20 text-blue-700 dark:text-blue-300">
              <Receipt className="h-4 w-4" />
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-2xl sm:text-3xl font-black text-blue-700 dark:text-blue-400 tabular-nums tracking-tight">
              {formatPrice(revenue.invoicedTTC)}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-0.5">
              <span>{revenue.invoiceCount} facture(s) émises</span>
            </div>
          </div>

          <div className="pt-2 border-t border-blue-500/15">
            <ExecutiveTrendBadge percent={trends.revenueTTC} periodLabel={trends.previousPeriodLabel} />
          </div>
        </div>

        {/* Tuile 2 : Trésorerie Encaissée */}
        <div className="p-5 rounded-3xl bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border border-emerald-500/20 dark:border-emerald-900/40 shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-900 dark:text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
              <Banknote className="h-3.5 w-3.5 text-emerald-600" /> Encaissé Réel
            </span>
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-2xl sm:text-3xl font-black text-emerald-700 dark:text-emerald-400 tabular-nums tracking-tight">
              {formatPrice(revenue.collectedTTC)}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-0.5">
              <span>En compte bancaire</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{collectionRate.toFixed(0)}% collecté</span>
            </div>
          </div>

          <div className="pt-2 border-t border-emerald-500/15 flex items-center justify-between text-xs">
            <span className="text-muted-foreground text-[11px]">Reste à recouvrer :</span>
            <span className="font-bold text-foreground tabular-nums text-[11px]">{formatPrice(revenue.outstandingTTC)}</span>
          </div>
        </div>

        {/* Tuile 3 : Charges Directes Totales */}
        <div className="p-5 rounded-3xl bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent border border-rose-500/20 dark:border-rose-900/40 shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-rose-900 dark:text-rose-300 uppercase tracking-wider flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5 text-rose-600" /> Charges Totales
            </span>
            <div className="p-2 rounded-xl bg-rose-500/20 text-rose-700 dark:text-rose-300">
              <Wallet className="h-4 w-4" />
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-2xl sm:text-3xl font-black text-rose-700 dark:text-rose-400 tabular-nums tracking-tight">
              {formatPrice(expenses.total)}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-0.5">
              <span>Carburant, atelier, achats &amp; FDR</span>
            </div>
          </div>

          <div className="pt-2 border-t border-rose-500/15">
            <ExecutiveTrendBadge
              percent={trends.expensesTotal}
              higherIsBetter={false}
              periodLabel={trends.previousPeriodLabel}
            />
          </div>
        </div>

        {/* Tuile 4 : CARTE STAR HÉROÏQUE — Résultat Brut d'Exploitation (HT) */}
        <div
          className={`p-5 rounded-3xl shadow-lg transition-all flex flex-col justify-between space-y-3 relative overflow-hidden ${
            result.grossHT >= 0
              ? "bg-gradient-to-br from-emerald-700 via-emerald-800 to-teal-950 text-white border border-emerald-500/40 shadow-emerald-950/40"
              : "bg-gradient-to-br from-rose-700 via-rose-800 to-red-950 text-white border border-rose-500/40 shadow-rose-950/40"
          }`}
        >
          {/* Lueur subtile en arrière-plan */}
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-28 h-28 bg-white/10 rounded-full blur-2xl pointer-events-none" />

          <div className="flex items-center justify-between relative z-10">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-200 flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> Résultat Brut (HT)
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-white/20 text-white backdrop-blur-xs border border-white/30">
              Marge : {result.marginPercent.toFixed(1)}%
            </span>
          </div>

          <div className="space-y-0.5 relative z-10">
            <div className="text-3xl sm:text-4xl font-black tabular-nums tracking-tight text-white">
              {formatPrice(result.grossHT)}
            </div>
            <p className="text-[11px] text-emerald-100/80">
              Bénéfice net conservé après toutes charges directes
            </p>
          </div>

          <div className="pt-2 border-t border-white/20 relative z-10 flex items-center justify-between">
            <span className="text-[11px] text-emerald-200">Évolution :</span>
            {trends.grossHT != null && (
              <span className="text-xs font-extrabold text-white tabular-nums">
                {trends.grossHT > 0 ? `+${trends.grossHT.toFixed(1)}%` : `${trends.grossHT.toFixed(1)}%`} vs {trends.previousPeriodLabel.toLowerCase()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 3. Micro-Chips d'Alertes Stratégiques DG (Impayés & Immobilisations) */}
      {hasAlerts && (
        <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-2xl bg-amber-500/10 dark:bg-amber-950/30 border border-amber-500/20 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300 mr-1">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span>Signaux d'Alerte Direction :</span>
          </div>

          {alerts.overdueInvoices > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-500/30 font-medium">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              <strong>{alerts.overdueInvoices}</strong> facture(s) client en retard d'échéance
            </span>
          )}

          {alerts.outOfServiceVehicles > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-rose-500/20 text-rose-800 dark:text-rose-200 border border-rose-500/30 font-medium">
              <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
              <strong>{alerts.outOfServiceVehicles}</strong> camion(s) hors service
            </span>
          )}

          {alerts.vehiclesImmobilizedOver48h > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-rose-500/20 text-rose-800 dark:text-rose-200 border border-rose-500/30 font-medium">
              <Clock className="h-3.5 w-3.5 text-rose-600" />
              <strong>{alerts.vehiclesImmobilizedOver48h}</strong> camion(s) immobilisé(s) atelier &gt; 48 h
            </span>
          )}
        </div>
      )}
    </div>
  );
}
