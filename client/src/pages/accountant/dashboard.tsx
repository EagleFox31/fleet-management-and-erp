import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Banknote, Calculator, FileText, Fuel, Landmark, Receipt, Store, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardShell, HeaderCard, KpiGrid, KpiTile } from "@/components/design-system";
import { UNAVAILABLE } from "@/components/dashboard/kpi-tiles";
import { InlineQueryError } from "@/components/ui/inline-query-error";
import { useAuth } from "@/hooks/useAuth";
import { userMessageOf } from "@/lib/api-error";
import { listQueryView, queryView } from "@/lib/query-view";
import { formatPrice } from "@/lib/utils";
import type { PendingInvoice } from "@shared/contracts/pending-invoices";
import { TREASURY_BASE_PATH, type TreasuryAccount } from "@shared/contracts/treasury";

/** `GET /api/supplier-invoices/statistics` : seuls les totaux globaux sont lus ici. */
type SupplierInvoiceStatistics = { totalInvoices: number; totalBalance: string };
/** `GET /api/finance/receivables-aging` : totaux des factures client en attente de paiement. */
type ReceivablesAging = { totals: { count: number; netPayable: number } };

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/**
 * Tableau de bord du comptable : ce qui reste à encaisser, ce qui reste à régler, les soldes
 * des comptes. Chaque tuile tient à sa propre requête : une panne affiche « Indisponible »
 * et le message lisible, jamais un zéro.
 */
export default function AccountantDashboard() {
  const { user } = useAuth();

  const pendingQuery = useQuery<PendingInvoice[]>({ queryKey: ["/api/billing/pending-invoices"] });
  const agingQuery = useQuery<ReceivablesAging>({ queryKey: ["/api/finance/receivables-aging"] });
  const supplierStatsQuery = useQuery<SupplierInvoiceStatistics>({ queryKey: ["/api/supplier-invoices/statistics"] });
  const accountsQuery = useQuery<TreasuryAccount[]>({ queryKey: [`${TREASURY_BASE_PATH}/accounts`] });

  const pending = listQueryView<PendingInvoice>(pendingQuery);
  const aging = queryView(agingQuery);
  const supplierStats = queryView(supplierStatsQuery);
  const accounts = listQueryView<TreasuryAccount>(accountsQuery);

  const pendingAmount = pending.kind === "ready" ? sum(pending.data.map((invoice) => Number(invoice.amount) || 0)) : null;
  const balanceOf = (kind: TreasuryAccount["kind"]) =>
    accounts.kind === "ready"
      ? sum(accounts.data.filter((account) => account.kind === kind && account.isActive).map((account) => Number(account.currentBalance) || 0))
      : null;
  const bankBalance = balanceOf("bank");
  const cashBalance = balanceOf("cash");
  const fuelCardBalance = balanceOf("fuel_card");

  const tileValue = (view: { kind: string }, value: string | number | null) =>
    view.kind === "error" ? UNAVAILABLE : view.kind === "loading" || value === null ? "…" : value;
  const tileSub = (view: { kind: string; error?: unknown }, fallback: string, ok: string) =>
    view.kind === "error" ? userMessageOf(view.error, fallback) : ok;

  const links = [
    { href: "/operations", label: "Facturation client", hint: "Opérations à facturer, factures émises, règlements", icon: Receipt },
    { href: "/procurement/invoices", label: "Factures fournisseur", hint: "Validation, approbation et règlement", icon: FileText },
    { href: "/fuel", label: "Carte carburant", hint: "Recharges et solde de la carte", icon: Fuel },
    { href: "/procurement/suppliers", label: "Fournisseurs", hint: "Fiches et encours fournisseurs", icon: Store },
    { href: "/reports", label: "Rapports", hint: "Inventaire et indicateurs financiers", icon: TrendingUp },
  ];

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Tableau de bord · Comptable"
        title={user?.name ? `Bienvenue, ${user.name}` : "Tableau de bord"}
        subtitle="Encaissements à suivre, règlements à faire et soldes des comptes"
        icon={<Calculator className="h-5 w-5" />}
      >
        <KpiGrid columns={4}>
          <KpiTile
            data-testid="accountant-kpi-receivables"
            label="À encaisser (clients)"
            featured
            value={tileValue(aging, aging.kind === "ready" ? formatPrice(aging.data.totals.netPayable) : null)}
            subValue={tileSub(
              aging,
              "Les factures en attente de paiement sont momentanément indisponibles.",
              aging.kind === "ready" ? `${aging.data.totals.count} facture${aging.data.totals.count > 1 ? "s" : ""} déposée${aging.data.totals.count > 1 ? "s" : ""}, net à recevoir` : "Net à recevoir",
            )}
            icon={<Banknote className="h-4 w-4" />}
            iconWrapperClassName="bg-primary/10 text-primary-text"
          />
          <KpiTile
            data-testid="accountant-kpi-pending-invoices"
            label="À facturer (clients)"
            value={tileValue(pending, pendingAmount === null ? null : formatPrice(pendingAmount))}
            subValue={tileSub(
              pending,
              "Les opérations à facturer sont momentanément indisponibles.",
              pending.kind === "ready" ? `${pending.data.length} client${pending.data.length > 1 ? "s" : ""} avec des opérations non facturées` : "Opérations non facturées",
            )}
            icon={<Receipt className="h-4 w-4" />}
            iconWrapperClassName="bg-accent text-accent-foreground"
          />
          <KpiTile
            data-testid="accountant-kpi-supplier-balance"
            label="À régler (fournisseurs)"
            value={tileValue(supplierStats, supplierStats.kind === "ready" ? formatPrice(supplierStats.data.totalBalance) : null)}
            subValue={tileSub(
              supplierStats,
              "Les factures fournisseur sont momentanément indisponibles.",
              supplierStats.kind === "ready" ? `Reste dû sur ${supplierStats.data.totalInvoices} facture${supplierStats.data.totalInvoices > 1 ? "s" : ""}` : "Reste dû",
            )}
            icon={<FileText className="h-4 w-4" />}
            iconWrapperClassName="bg-warning/10 text-warning-text"
          />
          <KpiTile
            data-testid="accountant-kpi-bank"
            label="Banque"
            value={tileValue(accounts, bankBalance === null ? null : formatPrice(bankBalance))}
            subValue={tileSub(
              accounts,
              "Les comptes de trésorerie sont momentanément indisponibles.",
              accounts.kind === "ready" ? `Caisse ${formatPrice(cashBalance ?? 0)} · Carte ${formatPrice(fuelCardBalance ?? 0)}` : "Solde des comptes actifs",
            )}
            icon={<Landmark className="h-4 w-4" />}
            iconWrapperClassName="bg-success/10 text-success"
          />
        </KpiGrid>
      </HeaderCard>

      <CardShell>
        <div className="px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Comptes de trésorerie</p>
          {accounts.kind === "error" ? (
            <InlineQueryError
              error={accounts.error}
              fallback="Les comptes de trésorerie sont momentanément indisponibles."
              onRetry={() => accountsQuery.refetch()}
              isRetrying={accounts.isRetrying}
            />
          ) : accounts.kind === "loading" ? (
            <p className="text-sm text-gray-500">Chargement…</p>
          ) : accounts.data.length === 0 ? (
            <p className="text-sm text-gray-500">Aucun compte de trésorerie n'est encore ouvert.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {accounts.data.map((account) => (
                <div key={account.id} className="flex items-center justify-between py-2" data-testid={`accountant-account-${account.id}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{account.label}</p>
                    <p className="text-xs text-gray-500">
                      {account.code}
                      {account.bankName ? ` · ${account.bankName}` : ""}
                      {account.isActive ? "" : " · clôturé"}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-gray-800 tabular-nums">{formatPrice(account.currentBalance)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardShell>

      <CardShell>
        <div className="px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Accès rapides</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {links.map(({ href, label, hint, icon: Icon }) => (
              <Link key={href} href={href}>
                <Button variant="outline" className="w-full h-auto justify-between gap-3 px-3 py-2.5 text-left" data-testid={`accountant-link-${href.replace(/\//g, "-").replace(/^-/, "")}`}>
                  <span className="flex items-center gap-3 min-w-0">
                    <Icon className="h-4 w-4 shrink-0 text-gray-500" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-xs font-normal text-gray-500 truncate">{hint}</span>
                    </span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                </Button>
              </Link>
            ))}
          </div>
        </div>
      </CardShell>
    </div>
  );
}
