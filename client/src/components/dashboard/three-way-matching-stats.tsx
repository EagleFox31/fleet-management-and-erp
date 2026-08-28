import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { GitMerge, ChevronRight, CheckCircle2, AlertTriangle, HelpCircle, FileText, Wallet } from "lucide-react";
import { formatPrice } from "@/lib/utils";

interface InvoiceStats {
  totalInvoices: number;
  totalAmountHT: string;
  totalAmountTTC: string;
  totalPaid: string;
  totalBalance: string;
  /** Renvoyé par l'API mais plus affiché ici: voir /procurement/invoices. */
  byStatus: Array<{
    status: string;
    label: string;
    count: number;
    totalAmount: string;
    totalBalance: string;
  }>;
  discrepancies: {
    total: number;
    averageVariance: string;
    percentage: string;
  };
  topSuppliers: Array<{
    supplierName: string;
    totalInvoices: number;
    totalAmount: string;
  }>;
}

export function ThreeWayMatchingStats() {
  const [, setLocation] = useLocation();
  const [showHelp, setShowHelp] = useState(false);

  const { data: stats, isLoading } = useQuery<InvoiceStats>({
    queryKey: ["/api/supplier-invoices/statistics"],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <GitMerge className="h-4 w-4" />
            Contrôle 3 voies
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (!stats) return null;

  const matchRate = stats.totalInvoices > 0
    ? Math.round(((stats.totalInvoices - stats.discrepancies.total) / stats.totalInvoices) * 100)
    : 0;

  const discrepancyRate = parseFloat(stats.discrepancies.percentage || '0');
  // Nombre de factures conformes, pour dire "3 factures sur 4" plutôt qu'un
  // pourcentage seul: 75% ne parle pas quand il n'y a que 4 factures.
  const conformesCount = Math.max(0, stats.totalInvoices - stats.discrepancies.total);

  // Déjà réglé = facturé - reste à payer. On ne prend PAS `stats.totalPaid`:
  // côté serveur il n'additionne que les factures au statut `paid`, donc il
  // ignore les règlements partiels et ne concorderait pas avec les deux
  // montants affichés ici.
  const dejaRegle = Math.max(
    0,
    parseFloat(stats.totalAmountTTC || "0") - parseFloat(stats.totalBalance || "0"),
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <GitMerge className="h-4 w-4" />
            Contrôle 3 voies
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              aria-label="Qu'est-ce que le contrôle 3 voies ?"
              aria-expanded={showHelp}
              className="p-1 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
              data-testid="button-help-three-way"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </CardTitle>
          {/* Pas de "du mois": getStatistics() lit TOUTES les factures
              fournisseurs, sans filtre de date. */}
          <span className="text-xs text-muted-foreground">
            sur {stats.totalInvoices} facture{stats.totalInvoices > 1 ? "s" : ""} fournisseur
            {stats.totalInvoices > 1 ? "s" : ""}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showHelp && (
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 space-y-2">
            <p className="text-xs text-gray-700 leading-relaxed">
              Le <strong>contrôle 3 voies</strong> compare automatiquement trois documents
              avant tout paiement : le <strong>bon de commande</strong>, la
              <strong> réception</strong> et la <strong>facture du fournisseur</strong>.
            </p>
            <p className="text-xs text-gray-700 leading-relaxed">
              Si les trois concordent, la facture est <strong>conforme</strong>. Sinon un
              <strong> écart</strong> est signalé : quantité livrée différente de la commande,
              ou montant facturé différent du montant convenu. Un écart doit être traité
              avant le règlement.
            </p>
          </div>
        )}
        {/* Taux de matching */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-green-50/60 dark:bg-green-950/20 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              {/* "Conformes" et non "Validées": `Validées` est déjà un STATUT de
                  facture affiché plus bas. Le même mot désignait deux notions
                  différentes dans la même carte. */}
              <span className="text-xs text-muted-foreground">Conformes</span>
            </div>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{matchRate}%</p>
            <p className="text-xs text-muted-foreground">
              {conformesCount} facture{conformesCount > 1 ? "s" : ""} sans écart
            </p>
          </div>
          <div className={`rounded-lg border p-3 ${discrepancyRate > 20 ? 'bg-red-50/60 dark:bg-red-950/20' : 'bg-amber-50/60 dark:bg-amber-950/20'}`}>
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className={`h-3.5 w-3.5 ${discrepancyRate > 20 ? 'text-red-500' : 'text-amber-500'}`} />
              <span className="text-xs text-muted-foreground">Écarts</span>
            </div>
            <p className={`text-2xl font-bold ${discrepancyRate > 20 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {discrepancyRate}%
            </p>
            <p className="text-xs text-muted-foreground">
              {stats.discrepancies.total} à traiter, écart moyen {stats.discrepancies.averageVariance}%
            </p>
          </div>
        </div>

        {/* Barre de progression globale */}
        <div>
          {/* Le pourcentage est déjà en gros dans la tuile "Conformes":
              la barre en est la représentation visuelle, pas une répétition
              du chiffre. On indique plutôt l'objectif à atteindre. */}
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Taux de conformité</span>
            <span>{matchRate >= 80 ? "Objectif atteint" : "Objectif : 80%"}</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${matchRate >= 80 ? 'bg-green-500' : matchRate >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${matchRate}%` }}
            />
          </div>
        </div>

        {/* Montants */}
        {/* Même motif de tuile que « Conformes » / « Écarts » plus haut:
            deux paires de chiffres dans la même carte doivent se lire pareil. */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-slate-50/60 dark:bg-slate-900/20 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <FileText className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-xs text-muted-foreground">Total facturé TTC</span>
            </div>
            <p className="text-lg font-bold tabular-nums text-slate-700 dark:text-slate-200">
              {formatPrice(parseFloat(stats.totalAmountTTC))}
            </p>
            <p className="text-xs text-muted-foreground">
              dont {formatPrice(dejaRegle)} réglés
            </p>
          </div>
          <div className="rounded-lg border bg-orange-50/60 dark:bg-orange-950/20 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Wallet className="h-3.5 w-3.5 text-orange-500" />
              <span className="text-xs text-muted-foreground">Reste à payer</span>
            </div>
            <p className="text-lg font-bold tabular-nums text-orange-600 dark:text-orange-400">
              {formatPrice(parseFloat(stats.totalBalance))}
            </p>
            <p className="text-xs text-muted-foreground">aux fournisseurs</p>
          </div>
        </div>

        {/* Le détail par statut a été retiré: il relève du circuit de validation
            (reçue -> validée -> approuvée -> payée), pas du contrôle 3 voies qui
            mesure la conformité. Il créait en outre une collision de vocabulaire,
            « Validées » désignant ici la conformité et là un statut.
            L'information reste accessible, et filtrable, sur /procurement/invoices. */}

        {/* L'écart est le seul signal actionnable de la carte: on donne un accès
            direct à la page qui permet de le traiter, plutôt que de renvoyer vers
            la liste générale. Bouton affiché uniquement s'il y a quelque chose à
            faire — sinon la carte reste purement informative. */}
        <div className="space-y-2 pt-1">
          {stats.discrepancies.total > 0 && (
            <Button
              size="sm"
              className="w-full text-xs bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => setLocation('/procurement/invoices/discrepancies')}
              data-testid="button-treat-discrepancies"
            >
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
              Traiter {stats.discrepancies.total} écart{stats.discrepancies.total > 1 ? "s" : ""}
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => setLocation('/procurement/invoices')}
          >
            Voir les factures fournisseurs
            <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
