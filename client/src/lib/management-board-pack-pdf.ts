import { PDFExporter } from "@/lib/pdf-export";
import { formatPrice } from "@/lib/utils";
import {
  MANAGEMENT_PERIOD_LABELS,
  type ManagementDashboardResponse,
} from "@shared/constants/management-dashboard";

function formatTrend(value: number | null): string {
  if (value == null) {
    return "Nouveau";
  }
  if (Math.abs(value) < 0.05) {
    return "Stable";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} %`;
}

export function exportManagementBoardPackPdf(data: ManagementDashboardResponse): void {
  const exporter = new PDFExporter();
  const periodLabel = MANAGEMENT_PERIOD_LABELS[data.period];

  const sections = [
    {
      title: "Synthèse financière",
      data: {
        "Période": `${data.periodStart} → ${data.periodEnd} (${periodLabel})`,
        "CA facturé (TTC)": formatPrice(data.revenue.invoicedTTC),
        "CA facturé (HT)": formatPrice(data.revenue.invoicedHT),
        "Encaissé": formatPrice(data.revenue.collectedTTC),
        "Impayés": formatPrice(data.revenue.outstandingTTC),
        "Charges totales (HT)": formatPrice(data.expenses.total),
        "Résultat brut (HT)": formatPrice(data.result.grossHT),
        "Marge": `${data.result.marginPercent.toFixed(1)} %`,
      },
    },
    {
      title: `Tendances vs ${data.trends.previousPeriodLabel}`,
      data: {
        "CA facturé (TTC)": formatTrend(data.trends.revenueTTC),
        "Charges totales": formatTrend(data.trends.expensesTotal),
        "Résultat brut (HT)": formatTrend(data.trends.grossHT),
        "Marge": formatTrend(data.trends.marginPercent),
      },
    },
    {
      title: "Détail des charges (HT)",
      data: {
        Carburant: formatPrice(data.expenses.fuel),
        Maintenance: formatPrice(data.expenses.maintenance),
        "Achats fournisseurs": formatPrice(data.expenses.suppliers),
      },
    },
    {
      title: "Flotte",
      data: {
        "Total véhicules": String(data.fleet.total),
        Opérationnels: String(data.fleet.operational),
        "En maintenance": String(data.fleet.maintenance),
        "Hors service": String(data.fleet.outOfService),
      },
    },
    {
      title: "Top clients (CA TTC)",
      data: Object.fromEntries(
        data.topClients.length > 0
          ? data.topClients.map((client, index) => [
              `${index + 1}. ${client.clientName}`,
              `${formatPrice(client.invoicedTTC)} (${client.invoiceCount} fact.)`,
            ])
          : [["—", "Aucune facture sur la période"]],
      ),
    },
    {
      title: "Top marchandises / cargo",
      data: Object.fromEntries(
        data.topCargoTypes.length > 0
          ? data.topCargoTypes.map((cargo, index) => [
              `${index + 1}. ${cargo.cargoLabel}`,
              `${cargo.missionCount} mission(s) · carburant ${formatPrice(cargo.fuelCost)}`,
            ])
          : [["—", "Aucune mission sur la période"]],
      ),
    },
    {
      title: "Top destinations",
      data: Object.fromEntries(
        data.topDestinations.length > 0
          ? data.topDestinations.map((destination, index) => [
              `${index + 1}. ${destination.destination}`,
              `${destination.missionCount} mission(s)`,
            ])
          : [["—", "Aucune mission sur la période"]],
      ),
    },
    {
      title: "Alertes",
      data: {
        "Factures client en retard": String(data.alerts.overdueInvoices),
        "Véhicules hors service": String(data.alerts.outOfServiceVehicles),
      },
    },
  ];

  const filename = `Rapport_Direction_${data.periodStart}_${data.periodEnd}.pdf`;
  exporter.exportDetails(
    "Rapport Direction",
    `Rapport généré le ${new Date().toLocaleDateString("fr-FR")} · ${periodLabel}`,
    sections,
    filename,
  );
}
