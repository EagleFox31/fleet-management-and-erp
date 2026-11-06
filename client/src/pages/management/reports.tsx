import { useMemo, useState, useEffect } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Award,
  Banknote,
  Calendar,
  CheckCircle2,
  ChevronRight,
  DollarSign,
  Download,
  FileSpreadsheet,
  FileText,
  Flame,
  Gauge,
  LayoutDashboard,
  Mail,
  Percent,
  Receipt,
  Route,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  Truck,
  Wallet,
  Wrench,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { CardShell, HeaderCard, PremiumTabsNav, SectionLabel } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { ManagementPeriodSelector } from "@/components/management/management-period-selector";
import { ManagementDashboardInfoTip } from "@/components/management/management-dashboard-info-tip";
import { exportManagementBoardPackPdf } from "@/lib/management-board-pack-pdf";
import { formatDistance, formatPrice } from "@/lib/utils";
import { useFeatureFlags } from "@/hooks/use-feature";
import {
  REPORT_TAB_DEFS,
  type ReportTabId,
  reportTabForLocation,
  visibleReportTabs,
} from "@/lib/management-report-tabs";
import type {
  ManagementDashboardResponse,
  ManagementPeriod,
} from "@shared/constants/management-dashboard";

const REPORT_TAB_ICONS: Record<ReportTabId, typeof Sparkles> = {
  board_pack: Sparkles,
  finance: Banknote,
  fleet: Truck,
  drivers: Award,
  scheduled: Mail,
};

const REPORT_TABS = REPORT_TAB_DEFS.map((tab) => ({
  ...tab,
  icon: <TabIcon icon={REPORT_TAB_ICONS[tab.value]} />,
}));

function exportCsvData(data: ManagementDashboardResponse, reportType: string) {
  const rows = [
    ["Type de Rapport", reportType],
    ["Période", `${data.periodStart} au ${data.periodEnd}`],
    ["CA Facturé TTC", data.revenue.invoicedTTC],
    ["CA Facturé HT", data.revenue.invoicedHT],
    ["Encaissé TTC", data.revenue.collectedTTC],
    ["Créances Impayées TTC", data.revenue.outstandingTTC],
    ["Charges Totales HT", data.expenses.total],
    ["Dépenses Carburant HT", data.expenses.fuel],
    ["Achats Fournisseurs HT", data.expenses.suppliers],
    ["Maintenance Atelier HT", data.expenses.maintenance],
    ["Frais de Route Chauffeurs HT", data.expenses.roadExpenses],
    ["Résultat Brut d'Exploitation HT", data.result.grossHT],
    ["Taux de Marge Brute %", data.result.marginPercent.toFixed(2)],
    ["PRK Moyen (FCFA/km)", data.executiveKpis.prk.fcfPerKm ?? "N/A"],
    ["CPK Maintenance (FCFA/km)", data.executiveKpis.cpkMaintenance.fcfPerKm ?? "N/A"],
    ["Immobilisation Atelier Moyenne (h/OT)", data.executiveKpis.downtime.averageHoursPerCompletedOrder ?? "N/A"],
  ];

  const csvContent =
    "data:text/csv;charset=utf-8,\uFEFF" +
    rows.map((e) => e.map((val) => `"${val}"`).join(";")).join("\n");

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute(
    "download",
    `FleetOS-Rapport-${reportType}-${data.periodStart}-${data.periodEnd}.csv`,
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function ManagementReportsPage() {
  const [location, setLocation] = useLocation();
  const [period, setPeriod] = useState<ManagementPeriod>("month");

  // Onglets et onglet actif suivent les drapeaux, comme la barre latérale : une URL directe vers
  // un onglet masqué retombe sur l'onglet par défaut.
  const flags = useFeatureFlags();
  const tabs = useMemo(() => visibleReportTabs(REPORT_TABS, flags), [flags]);
  const currentTab = useMemo(() => reportTabForLocation(location, flags), [location, flags]);
  const showTab = (value: ReportTabId) => tabs.some((t) => t.value === value);

  const handleTabChange = (value: string) => {
    const tab = tabs.find((t) => t.value === value);
    if (tab) {
      setLocation(tab.path);
    }
  };

  const { data, isLoading } = useQuery<ManagementDashboardResponse>({
    queryKey: ["/api/management/dashboard", { period }],
    queryFn: async () => {
      const response = await fetch(`/api/management/dashboard?period=${period}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Impossible de charger les rapports Direction");
      }
      return response.json();
    },
    staleTime: 30_000,
  });

  return (
    <div className="space-y-6">
      {/* 1. Header Card Exécutif Aérien */}
      <HeaderCard
        moduleLabel="Direction · Reporting Exécutif"
        title="Rapports Direction &amp; Board Packs"
        subtitle="Génération, prévisualisation interactive et distribution automatisée des synthèses stratégiques"
        icon={<FileText className="h-5 w-5" />}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-2xl border border-slate-800">
            <ManagementPeriodSelector value={period} onChange={setPeriod} />
            {data && (
              <ManagementDashboardInfoTip
                periodStart={data.periodStart}
                periodEnd={data.periodEnd}
                previousPeriodStart={data.previousPeriodStart}
                previousPeriodEnd={data.previousPeriodEnd}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" asChild className="rounded-xl">
              <Link href="/dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Tableau de bord
              </Link>
            </Button>

            <Button
              type="button"
              size="sm"
              disabled={!data || isLoading}
              onClick={() => data && exportManagementBoardPackPdf(data)}
              className="bg-success hover:bg-success text-white font-semibold rounded-xl shadow-md shadow-emerald-900/30 cursor-pointer"
            >
              <Download className="mr-2 h-4 w-4" />
              Télécharger le PDF
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!data || isLoading}
              onClick={() => data && exportCsvData(data, currentTab)}
              className="rounded-xl"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4 text-success" />
              Export CSV
            </Button>
          </div>
        </div>
      </HeaderCard>

      {/* 2. Sous-Menus Dédiés & Navigation par Onglets Aérée */}
      <Tabs value={currentTab} onValueChange={handleTabChange} className="space-y-6">
        <PremiumTabsNav tabs={tabs} />

        {/* ========================================================================= */}
        {/* SOUS-MENU 1 : Board Pack Stratégique Direction                            */}
        {/* ========================================================================= */}
        <TabsContent value="board_pack" className="space-y-6">
          {isLoading || !data ? (
            <Skeleton className="h-96 w-full rounded-3xl" />
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-foreground">Board Pack Direction Générale (Complet)</h3>
                  <p className="text-xs text-muted-foreground">Document officiel 4 pages pour le Conseil d'Administration et le Comité de Direction</p>
                </div>
                <span className="text-xs font-bold px-3 py-1 rounded-full bg-success/15 text-success dark:text-success border border-success">
                  Document Stratégique 4 Pages
                </span>
              </div>

              {/* Bento Synthèse Board Pack */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 space-y-1">
                  <span className="text-xs font-medium text-muted-foreground block">Chiffre d'Affaires Facturé (TTC)</span>
                  <span className="text-2xl font-black text-blue-700 dark:text-blue-400 tabular-nums">
                    {formatPrice(data.revenue.invoicedTTC)}
                  </span>
                  <span className="text-[11px] text-muted-foreground block">{data.revenue.invoiceCount} factures émises</span>
                </div>

                <div className="p-4 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-900/40 space-y-1">
                  <span className="text-xs font-medium text-muted-foreground block">Charges Directes Totales (HT)</span>
                  <span className="text-2xl font-black text-rose-700 dark:text-rose-400 tabular-nums">
                    {formatPrice(data.expenses.total)}
                  </span>
                  <span className="text-[11px] text-muted-foreground block">Carburant + Fournisseurs + Atelier + FDR</span>
                </div>

                <div className="p-4 rounded-2xl bg-success/10 border border-success space-y-1">
                  <span className="text-xs font-medium text-success dark:text-success block">Résultat Brut d'Exploitation (HT)</span>
                  <span className="text-2xl font-black text-success dark:text-success tabular-nums">
                    {formatPrice(data.result.grossHT)}
                  </span>
                  <span className="text-[11px] font-bold text-success block">Marge : {data.result.marginPercent.toFixed(1)}% du CA HT</span>
                </div>

                <div className="p-4 rounded-2xl bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200/60 dark:border-purple-900/40 space-y-1">
                  <span className="text-xs font-medium text-muted-foreground block">Prix de Revient Km (PRK)</span>
                  <span className="text-2xl font-black text-purple-700 dark:text-purple-400 tabular-nums">
                    {data.executiveKpis.prk.fcfPerKm != null ? `${formatPrice(Math.round(data.executiveKpis.prk.fcfPerKm))}` : "—"}
                  </span>
                  <span className="text-[11px] text-muted-foreground block">{formatDistance(data.executiveKpis.prk.totalKm)} réels parcourus</span>
                </div>
              </div>

              {/* Sommaire & Décisions Board Pack */}
              <CardShell className="border border-slate-200/80 dark:border-slate-800 shadow-xs">
                <div className="p-5 space-y-4">
                  <SectionLabel>Sommaire du Document Board Pack Généré</SectionLabel>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-800 space-y-1">
                      <span className="font-bold text-foreground">Page 1 · Synthèse Financière &amp; Flux HT</span>
                      <p className="text-muted-foreground">Revenus, ventilation des charges, marge nette et comparatif vs période précédente.</p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-800 space-y-1">
                      <span className="font-bold text-foreground">Page 2 · Indicateurs Techniques &amp; PRK</span>
                      <p className="text-muted-foreground">Prix de revient km, usure mécanique CPK, downtime atelier et disponibilité de la flotte.</p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-800 space-y-1">
                      <span className="font-bold text-foreground">Page 3 · TCO Flotte &amp; Renouvellement d'Actif</span>
                      <p className="text-muted-foreground">Marge par tracteur, amortissement résiduel et candidats recommandés au remplacement.</p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-800 space-y-1">
                      <span className="font-bold text-foreground">Page 4 · Portefeuille Clients &amp; Arbitrages DG</span>
                      <p className="text-muted-foreground">Top 5 clients, corridors stratégiques, scorecards chauffeurs et plan d'action.</p>
                    </div>
                  </div>
                </div>
              </CardShell>
            </div>
          )}
        </TabsContent>

        {/* ========================================================================= */}
        {/* SOUS-MENU 2 : Trésorerie & Recouvrement (Finance & Banques)               */}
        {/* ========================================================================= */}
        {showTab("finance") && (
        <TabsContent value="finance" className="space-y-6">
          {isLoading || !data ? (
            <Skeleton className="h-96 w-full rounded-3xl" />
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-foreground">Rapport Trésorerie, Cash Flow &amp; Recouvrement</h3>
                  <p className="text-xs text-muted-foreground">Suivi des encaissements bancaires, créances clients et maîtrise des sorties de fonds</p>
                </div>
                <span className="text-xs font-bold px-3 py-1 rounded-full bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30">
                  Usage Comptabilité / Banques
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-5 rounded-3xl bg-success/10 dark:bg-success/20 border border-success/30 space-y-2">
                  <span className="text-xs font-semibold text-success dark:text-success">Encaissé (factures clients réglées)</span>
                  <div className="text-3xl font-black text-success dark:text-success tabular-nums">
                    {formatPrice(data.revenue.collectedTTC)}
                  </div>
                  <p className="text-xs text-success dark:text-success font-medium">
                    Taux de recouvrement : {((data.revenue.collectedTTC / Math.max(data.revenue.invoicedTTC, 1)) * 100).toFixed(0)}%
                  </p>
                </div>

                <div className="p-5 rounded-3xl bg-warning/10 dark:bg-warning/20 border border-warning/30 space-y-2">
                  <span className="text-xs font-semibold text-warning-text dark:text-warning-text">Créances Clients à Recouvrer</span>
                  <div className="text-3xl font-black text-warning-text dark:text-warning-text tabular-nums">
                    {formatPrice(data.revenue.outstandingTTC)}
                  </div>
                  <p className="text-xs text-warning-text dark:text-warning-text font-medium">
                    Factures émises non encore réglées
                  </p>
                </div>

                <div className="p-5 rounded-3xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 space-y-2">
                  <span className="text-xs font-semibold text-foreground">Poste Carburant (Gasoil)</span>
                  <div className="text-3xl font-black text-foreground tabular-nums">
                    {formatPrice(data.expenses.fuel)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {((data.expenses.fuel / Math.max(data.expenses.total, 1)) * 100).toFixed(0)}% du total des charges directes
                  </p>
                </div>
              </div>
            </div>
          )}
        </TabsContent>
        )}

        {/* ========================================================================= */}
        {/* SOUS-MENU 3 : Audit Flotte & TCO (Parc & Atelier)                         */}
        {/* ========================================================================= */}
        <TabsContent value="fleet" className="space-y-6">
          {isLoading || !data ? (
            <Skeleton className="h-96 w-full rounded-3xl" />
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-foreground">Audit Technique &amp; TCO du Parc Roulant</h3>
                  <p className="text-xs text-muted-foreground">Performance financière par tracteur, coût kilométrique d'usure et aide au renouvellement</p>
                </div>
                <span className="text-xs font-bold px-3 py-1 rounded-full bg-warning/15 text-warning-text dark:text-warning-text border border-warning">
                  Usage Exploitation / Atelier
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-5 rounded-3xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 space-y-2">
                  <span className="text-xs font-semibold text-foreground">Parc Actif sous TCO</span>
                  <div className="text-3xl font-black text-foreground tabular-nums">
                    {data.vehicleTco.summary.vehicleCount} camions
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Marge cumulée : {formatPrice(data.vehicleTco.summary.totalPeriodMarginHT)}
                  </p>
                </div>

                <div className="p-5 rounded-3xl bg-warning/10 dark:bg-warning/20 border border-warning/30 space-y-2">
                  <span className="text-xs font-semibold text-warning-text dark:text-warning-text">CPK Usure Mécanique</span>
                  <div className="text-3xl font-black text-warning-text dark:text-warning-text tabular-nums">
                    {data.executiveKpis.cpkMaintenance.fcfPerKm != null ? `${formatPrice(Math.round(data.executiveKpis.cpkMaintenance.fcfPerKm))}` : "—"}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Atelier + Achats pneumatiques
                  </p>
                </div>

                <div className="p-5 rounded-3xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/60 space-y-2">
                  <span className="text-xs font-semibold text-rose-800 dark:text-rose-300">Candidats Remplacement</span>
                  <div className="text-3xl font-black text-rose-700 dark:text-rose-400 tabular-nums">
                    {data.vehicleObsolescence.summary.replacementCandidates} tracteurs
                  </div>
                  <p className="text-xs text-rose-700 dark:text-rose-300 font-medium">
                    Maintenance annualisée &gt; Valeur résiduelle
                  </p>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ========================================================================= */}
        {/* SOUS-MENU 4 : Scorecard Capital Humain & Chauffeurs                       */}
        {/* ========================================================================= */}
        <TabsContent value="drivers" className="space-y-6">
          {isLoading || !data ? (
            <Skeleton className="h-96 w-full rounded-3xl" />
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-foreground">Scorecard Capital Humain &amp; Chauffeurs</h3>
                  <p className="text-xs text-muted-foreground">Palmarès d'éco-conduite, primes de performance, sinistralité et conformité des permis</p>
                </div>
                <span className="text-xs font-bold px-3 py-1 rounded-full bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30">
                  Usage RH / Sécurité Flotte
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-5 rounded-3xl bg-success/10 dark:bg-success/20 border border-success/30 space-y-2">
                  <span className="text-xs font-semibold text-success dark:text-success">Note Moyenne Flotte</span>
                  <div className="text-3xl font-black text-success dark:text-success tabular-nums">
                    {data.driverScorecard.summary.averageOverallScore ? `${Math.round(data.driverScorecard.summary.averageOverallScore)}/100` : "—"}
                  </div>
                  <p className="text-xs text-success dark:text-success font-medium">
                    {data.driverScorecard.summary.driverCount} conducteurs évalués
                  </p>
                </div>

                <div className="p-5 rounded-3xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 space-y-2">
                  <span className="text-xs font-semibold text-foreground">Consommation Médiane Flotte</span>
                  <div className="text-3xl font-black text-foreground tabular-nums">
                    {data.driverScorecard.summary.fleetMedianConsumptionL100 ? `${data.driverScorecard.summary.fleetMedianConsumptionL100.toFixed(1)} L/100` : "34.0 L/100"}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Référence L/100 km sur les corridors
                  </p>
                </div>

                <div className="p-5 rounded-3xl bg-warning/10 dark:bg-warning/20 border border-warning/30 space-y-2">
                  <span className="text-xs font-semibold text-warning-text dark:text-warning-text">Frais de Route (FDR Réels)</span>
                  <div className="text-3xl font-black text-warning-text dark:text-warning-text tabular-nums">
                    {formatPrice(data.expenses.roadExpenses)}
                  </div>
                  <p className="text-xs text-warning-text dark:text-warning-text font-medium">
                    Indemnités per diem versées sur missions
                  </p>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ========================================================================= */}
        {/* SOUS-MENU 5 : Distribution & Cadence Automatisée                          */}
        {/* ========================================================================= */}
        {showTab("scheduled") && (
        <TabsContent value="scheduled" className="space-y-6">
          {/* Aucun service d'envoi n'existe côté serveur: l'onglet le dit, plutôt
              que d'afficher une programmation et des destinataires fictifs. */}
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-foreground">Distribution des rapports</h3>
                <p className="text-xs text-muted-foreground">Transmission des rapports aux membres du comité</p>
              </div>
              <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-500/10 text-muted-foreground border border-slate-500/30">
                Non disponible
              </span>
            </div>

            <CardShell className="border border-slate-200/80 dark:border-slate-800 shadow-xs">
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-slate-500/10 text-muted-foreground border border-slate-500/30">
                    <Mail className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-foreground">Envoi automatique non disponible</h4>
                    <p className="text-xs text-muted-foreground">
                      Aucun rapport n'est envoyé par email pour l'instant, ni programmé.
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground pt-2 border-t border-slate-100 dark:border-slate-800">
                  Pour transmettre un rapport, utilisez <strong>Télécharger le PDF</strong> en haut de page,
                  puis joignez le fichier à votre email.
                </p>
              </div>
            </CardShell>
          </div>
        </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
