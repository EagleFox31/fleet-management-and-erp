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

function formatFcfPerKm(value: number | null): string {
  if (value == null) {
    return "Km réels insuffisants";
  }
  return `${formatPrice(Math.round(value))}/km`;
}

function formatHours(value: number | null): string {
  if (value == null) {
    return "—";
  }
  return `${value.toFixed(1)} h / OT`;
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
        "FDR missions (réels)": formatPrice(data.expenses.roadExpenses),
      },
    },
    {
      title: "TCO véhicule (période)",
      data: {
        "Véhicules avec activité": String(data.vehicleTco.summary.vehicleCount),
        "CA attribué HT": formatPrice(data.vehicleTco.summary.totalRevenueHT),
        "Coûts opérationnels HT": formatPrice(data.vehicleTco.summary.totalPeriodCostsHT),
        "Marge opérationnelle HT": formatPrice(data.vehicleTco.summary.totalPeriodMarginHT),
        "Assurances flotte HT": formatPrice(data.vehicleTco.summary.fleetInsuranceHT),
      },
    },
    {
      title: "Top véhicules (marge opérationnelle HT)",
      data: Object.fromEntries(
        data.vehicleTco.topByMargin.length > 0
          ? data.vehicleTco.topByMargin.map((vehicle, index) => [
              `${index + 1}. ${vehicle.registrationNumber}`,
              `${formatPrice(vehicle.periodMarginHT)} · ${vehicle.missionCount} mission(s)`,
            ])
          : [["—", "Aucun véhicule rentable sur la période"]],
      ),
    },
    {
      title: "Scorecard chauffeurs",
      data: {
        "Chauffeurs actifs": String(data.driverScorecard.summary.driverCount),
        "Note moyenne flotte": data.driverScorecard.summary.averageOverallScore != null
          ? `${Math.round(data.driverScorecard.summary.averageOverallScore)}/100`
          : "—",
        "Médiane consommation": data.driverScorecard.summary.fleetMedianConsumptionL100 != null
          ? `${data.driverScorecard.summary.fleetMedianConsumptionL100.toFixed(1)} L/100 km`
          : "—",
        "Chauffeurs avec incident": String(data.driverScorecard.summary.driversWithIncidents),
      },
    },
    {
      title: "Top chauffeurs (note globale)",
      data: Object.fromEntries(
        data.driverScorecard.topPerformers.length > 0
          ? data.driverScorecard.topPerformers.map((driver, index) => [
              `${index + 1}. ${driver.driverName}`,
              `${Math.round(driver.overallScore ?? 0)}/100 · ${driver.missionCount} mission(s)`,
            ])
          : [["—", "Aucun chauffeur noté sur la période"]],
      ),
    },
    {
      title: "Indice vétusté — candidats remplacement",
      data: Object.fromEntries(
        data.vehicleObsolescence.candidates.length > 0
          ? data.vehicleObsolescence.candidates.map((vehicle, index) => [
              `${index + 1}. ${vehicle.registrationNumber}`,
              `${formatPrice(vehicle.annualizedMaintenanceHT)} annualisé · résiduel ${formatPrice(vehicle.residualValueHT)}`,
            ])
          : [["—", "Aucun candidat sur la période"]],
      ),
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
      title: "Rentabilité par mission",
      data: {
        "Missions analysées": String(data.missionProfitability.summary.analyzedCount),
        "Missions rentables": String(data.missionProfitability.summary.profitableCount),
        "Missions déficitaires": String(data.missionProfitability.summary.deficitCount),
        "Marge cumulée HT": formatPrice(data.missionProfitability.summary.totalMarginHT),
        "Données incomplètes": String(data.missionProfitability.summary.incompleteDataCount),
      },
    },
    {
      title: "Top missions rentables (marge HT)",
      data: Object.fromEntries(
        data.missionProfitability.topProfitable.length > 0
          ? data.missionProfitability.topProfitable.map((mission, index) => [
              `${index + 1}. ${mission.orderNumber}`,
              `${formatPrice(mission.marginHT)} · ${mission.destination}`,
            ])
          : [["—", "Aucune mission rentable sur la période"]],
      ),
    },
    {
      title: "Missions déficitaires",
      data: Object.fromEntries(
        data.missionProfitability.worstDeficit.length > 0
          ? data.missionProfitability.worstDeficit.map((mission, index) => [
              `${index + 1}. ${mission.orderNumber}`,
              `${formatPrice(mission.marginHT)} · ${mission.destination}`,
            ])
          : [["—", "Aucune mission déficitaire sur la période"]],
      ),
    },
    {
      title: "Indicateurs exécutifs",
      data: {
        "PRK (FCFA/km)": formatFcfPerKm(data.executiveKpis.prk.fcfPerKm),
        "Km réels missions": String(data.executiveKpis.prk.totalKm),
        "Missions avec km réel": String(data.executiveKpis.prk.missionCount),
        "Missions exclues (km manquant)": String(data.executiveKpis.prk.missionsExcludedMissingKm),
        "Charges directes HT": formatPrice(data.executiveKpis.prk.directChargesHT),
        "CPK maintenance (FCFA/km)": formatFcfPerKm(data.executiveKpis.cpkMaintenance.fcfPerKm),
        "Achats pneus HT (fournisseur)": formatPrice(data.executiveKpis.cpkMaintenance.tireSupplierHT),
        "Immobilisation cumulée (h)": String(data.executiveKpis.downtime.totalImmobilizationHours),
        "Immobilisation moyenne / OT": formatHours(data.executiveKpis.downtime.averageHoursPerCompletedOrder),
      },
    },
    {
      title: "Alertes",
      data: {
        "Factures client en retard": String(data.alerts.overdueInvoices),
        "Véhicules hors service": String(data.alerts.outOfServiceVehicles),
        "Véhicules immobilisés > 48 h": String(data.alerts.vehiclesImmobilizedOver48h),
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
