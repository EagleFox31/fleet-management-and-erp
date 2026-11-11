import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Cliquet : couleurs de la palette Tailwind (text-red-600, bg-green-50, border-amber-200...) et surfaces en dur
// (bg-white, text-black) dans client/src. Le design system veut des jetons (text-destructive-text, bg-card,
// text-foreground...) : ils portent le contraste verifie et preparent un mode sombre (non supporte aujourd'hui).
// Le compte d'un fichier ne peut que baisser, un nouveau fichier ne peut pas en recevoir, un fichier assaini sort
// de la liste. Aucune couleur n'est migree ici : la liste fige l'existant, les tranches suivantes l'abaissent.
// Hors perimetre : gris neutres (gray, slate, zinc, neutral, stone), text-white, bg-black.
export const PALETTE =
  /(?<![\w-])(?:[a-z]+:)*(?:-?(?:text|bg|border|ring|fill|stroke|from|via|to|divide|outline|decoration|shadow)-(?:red|green|amber|yellow|orange|emerald|lime|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|bg-white|text-black)(?:\/\d+)?(?![\w-])/g;

const root = process.cwd();
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.(tsx?|jsx?)$/.test(e.name) ? [join(d, e.name)] : []));

export const count = (src: string) => (src.match(PALETTE) ?? []).length;

const GELES: Record<string, number> = {
  "client/src/App.tsx": 1,
  "client/src/components/AutomotiveLoader.tsx": 18,
  "client/src/components/admin/backups-panel.tsx": 6,
  "client/src/components/alerts/alerts-panel.tsx": 38,
  "client/src/components/charts/cpc-status-chart.tsx": 24,
  "client/src/components/charts/document-expiry-chart.tsx": 13,
  "client/src/components/charts/fuel-consumption-chart.tsx": 3,
  "client/src/components/charts/parts-consumption-chart.tsx": 3,
  "client/src/components/charts/stock-value-chart.tsx": 2,
  "client/src/components/charts/vehicle-status-chart.tsx": 13,
  "client/src/components/dashboard/client-revenue-chart.tsx": 14,
  "client/src/components/dashboard/dashboard-alerts-summary.tsx": 9,
  "client/src/components/dashboard/expiring-cpc-alert.tsx": 21,
  "client/src/components/dashboard/expiring-docs-alert.tsx": 31,
  "client/src/components/dashboard/kpi-card.tsx": 33,
  "client/src/components/dashboard/overdue-invoices-alert.tsx": 23,
  "client/src/components/dashboard/overdue-orders-alert.tsx": 26,
  "client/src/components/dashboard/recent-activity-feed.tsx": 66,
  "client/src/components/dashboard/supplier-scorecard.tsx": 2,
  "client/src/components/dashboard/three-way-matching-stats.tsx": 29,
  "client/src/components/dashboard/users-table.tsx": 41,
  "client/src/components/design-system/alert-banner-card.tsx": 10,
  "client/src/components/design-system/alert-modal.tsx": 8,
  "client/src/components/design-system/icon-square.tsx": 3,
  "client/src/components/design-system/kpi-tile.tsx": 2,
  "client/src/components/design-system/status-badge.tsx": 33,
  "client/src/components/design-system/status-metric-strip.tsx": 5,
  "client/src/components/design-system/urgency-badge.tsx": 6,
  "client/src/components/drivers/cpc-alerts-panel.tsx": 31,
  "client/src/components/drivers/cpc-update-form.tsx": 5,
  "client/src/components/fuel/fuel-record-detail-modal.tsx": 2,
  "client/src/components/fuel/fuel-record-form.tsx": 1,
  "client/src/components/fuel/fuel-record-table.tsx": 4,
  "client/src/components/fuel/fuel-statistics.tsx": 6,
  "client/src/components/help/contextual-help-button.tsx": 6,
  "client/src/components/help/contextual-help-panel.tsx": 9,
  "client/src/components/incidents/incident-list.tsx": 5,
  "client/src/components/inventory/part-requirement-status-help.tsx": 22,
  "client/src/components/inventory/part-table.tsx": 37,
  "client/src/components/inventory/tire-dot-input.tsx": 6,
  "client/src/components/inventory/tire-size-fields.tsx": 3,
  "client/src/components/inventory/tire-table.tsx": 23,
  "client/src/components/inventory/tire-wizard-form.tsx": 21,
  "client/src/components/layout/sidebar.tsx": 37,
  "client/src/components/layout/technician-bottom-nav.tsx": 7,
  "client/src/components/layout/topnav.tsx": 28,
  "client/src/components/maintenance/formatted-work-order-description.tsx": 43,
  "client/src/components/maintenance/maintenance-schedule-form.tsx": 2,
  "client/src/components/maintenance/work-order-form.tsx": 58,
  "client/src/components/maintenance/work-order-items-panel.tsx": 22,
  "client/src/components/maintenance/work-order-table.tsx": 57,
  "client/src/components/management/executive-corridor-map.tsx": 35,
  "client/src/components/management/management-dashboard-info-tip.tsx": 2,
  "client/src/components/management/management-driver-scorecard-panel.tsx": 6,
  "client/src/components/management/management-executive-hero.tsx": 94,
  "client/src/components/management/management-executive-kpis-panel.tsx": 4,
  "client/src/components/management/management-financial-overview.tsx": 54,
  "client/src/components/management/management-indicators-bento.tsx": 107,
  "client/src/components/management/management-mission-profitability-panel.tsx": 4,
  "client/src/components/management/management-period-selector.tsx": 5,
  "client/src/components/management/management-profitability-bento.tsx": 94,
  "client/src/components/management/management-ranking-panel.tsx": 17,
  "client/src/components/management/management-team-bento.tsx": 154,
  "client/src/components/management/management-team-visuals.tsx": 17,
  "client/src/components/management/management-trend-badge.tsx": 2,
  "client/src/components/management/management-vehicle-obsolescence-panel.tsx": 4,
  "client/src/components/management/management-vehicle-tco-panel.tsx": 6,
  "client/src/components/management/money-flow-panel.tsx": 97,
  "client/src/components/missions/mission-invoices-tab.tsx": 20,
  "client/src/components/onboarding/fleet-mascot.tsx": 20,
  "client/src/components/onboarding/mascot-helper.tsx": 14,
  "client/src/components/onboarding/onboarding-walkthrough.tsx": 11,
  "client/src/components/operations/clients-panel.tsx": 41,
  "client/src/components/operations/invoicing-dashboard.tsx": 42,
  "client/src/components/operations/missions-list.tsx": 10,
  "client/src/components/procurement/import-excel-dialog.tsx": 30,
  "client/src/components/procurement/procurement-tutorial-modal.tsx": 43,
  "client/src/components/procurement/supplier-combobox.tsx": 2,
  "client/src/components/pwa/pwa-install-banner.tsx": 8,
  "client/src/components/ui/animated-error.tsx": 30,
  "client/src/components/ui/data-table.tsx": 3,
  "client/src/components/ui/error-toast.tsx": 28,
  "client/src/components/ui/toast.tsx": 21,
  "client/src/components/users/users-overview.tsx": 8,
  "client/src/components/vehicles/document-expiry-panel.tsx": 7,
  "client/src/components/vehicles/vehicle-documents.tsx": 22,
  "client/src/components/vehicles/vehicle-export-import.tsx": 5,
  "client/src/components/vehicles/vehicle-form.tsx": 31,
  "client/src/components/vehicles/vehicle-health-score.tsx": 16,
  "client/src/components/vehicles/vehicle-status-history.tsx": 27,
  "client/src/components/vehicles/vehicle-table.tsx": 7,
  "client/src/components/vehicles/vehicle-tire-mount-dialog.tsx": 1,
  "client/src/components/vehicles/vehicle-tire-remove-dialog.tsx": 1,
  "client/src/components/vehicles/vehicle-tires-prompt-dialog.tsx": 1,
  "client/src/components/vehicles/vehicle-tires-status-badge.tsx": 3,
  "client/src/components/workflow/stepper.tsx": 4,
  "client/src/components/workflows/vehicle-acquisition-wizard.tsx": 31,
  "client/src/components/workflows/vehicle-acquisition-workflow.tsx": 42,
  "client/src/components/workflows/workflow-reminders.tsx": 29,
  "client/src/lib/maintenance-schedule-status.ts": 8,
  "client/src/lib/part-requirement-status.ts": 24,
  "client/src/lib/utils.ts": 14,
  "client/src/pages/admin/dashboard.tsx": 21,
  "client/src/pages/admin/import-backup.tsx": 20,
  "client/src/pages/admin/users.tsx": 15,
  "client/src/pages/auth/login.tsx": 36,
  "client/src/pages/client/dashboard.tsx": 6,
  "client/src/pages/dashboard.tsx": 25,
  "client/src/pages/dev/profiles.tsx": 17,
  "client/src/pages/driver/dashboard.tsx": 26,
  "client/src/pages/drivers/[id].tsx": 57,
  "client/src/pages/drivers/index.tsx": 27,
  "client/src/pages/exports/reports.tsx": 5,
  "client/src/pages/fuel/[id].tsx": 36,
  "client/src/pages/fuel/index.tsx": 44,
  "client/src/pages/inventory/[id].tsx": 64,
  "client/src/pages/inventory/index.tsx": 43,
  "client/src/pages/inventory/movements.tsx": 17,
  "client/src/pages/inventory/parts-database.tsx": 3,
  "client/src/pages/inventory/requests.tsx": 79,
  "client/src/pages/inventory/tires/index.tsx": 159,
  "client/src/pages/landing.tsx": 254,
  "client/src/pages/logistics/dashboard.tsx": 41,
  "client/src/pages/maintenance-planner.tsx": 1,
  "client/src/pages/maintenance-schedules.tsx": 1,
  "client/src/pages/maintenance-simple-new.tsx": 2,
  "client/src/pages/maintenance-simple.tsx": 1,
  "client/src/pages/maintenance/date-based-alerts.tsx": 29,
  "client/src/pages/maintenance/fault-catalog.tsx": 6,
  "client/src/pages/maintenance/gmao-dashboard.tsx": 81,
  "client/src/pages/maintenance/interventions.tsx": 24,
  "client/src/pages/maintenance/preventive.tsx": 12,
  "client/src/pages/maintenance/work-orders.tsx": 25,
  "client/src/pages/maintenance/work-orders/[id].tsx": 64,
  "client/src/pages/maintenance/work-orders/new.tsx": 15,
  "client/src/pages/management/reports.tsx": 36,
  "client/src/pages/management/team.tsx": 2,
  "client/src/pages/missions/[id].tsx": 39,
  "client/src/pages/missions/index.tsx": 33,
  "client/src/pages/missions/new.tsx": 7,
  "client/src/pages/operations/dashboard.tsx": 10,
  "client/src/pages/operations/invoices/[id].tsx": 29,
  "client/src/pages/operations/invoices/index.tsx": 21,
  "client/src/pages/procurement/invoices/[id].tsx": 49,
  "client/src/pages/procurement/invoices/discrepancies.tsx": 20,
  "client/src/pages/procurement/invoices/index.tsx": 45,
  "client/src/pages/procurement/invoices/new.tsx": 2,
  "client/src/pages/procurement/orders/[id].tsx": 43,
  "client/src/pages/procurement/orders/group.tsx": 38,
  "client/src/pages/procurement/orders/index.tsx": 38,
  "client/src/pages/procurement/orders/new.tsx": 33,
  "client/src/pages/procurement/suppliers/[id].tsx": 68,
  "client/src/pages/procurement/suppliers/edit.tsx": 33,
  "client/src/pages/procurement/suppliers/index.tsx": 36,
  "client/src/pages/procurement/suppliers/new.tsx": 30,
  "client/src/pages/profile.tsx": 48,
  "client/src/pages/reports/index.tsx": 51,
  "client/src/pages/secretary/dashboard.tsx": 46,
  "client/src/pages/settings.tsx": 40,
  "client/src/pages/technician/dashboard.tsx": 30,
  "client/src/pages/technician/fleet-status.tsx": 44,
  "client/src/pages/technician/my-work-orders.tsx": 54,
  "client/src/pages/technician/profile.tsx": 43,
  "client/src/pages/technician/vehicles.tsx": 14,
  "client/src/pages/technicians/index.tsx": 50,
  "client/src/pages/vehicles/[id].tsx": 66,
  "client/src/pages/vehicles/document-renew.tsx": 24,
  "client/src/pages/vehicles/documents.tsx": 69,
  "client/src/pages/vehicles/immatriculation/[registration].tsx": 3,
  "client/src/pages/vehicles/index.tsx": 15,
  "client/src/pages/vehicles/new.tsx": 4,
  "client/src/pages/warehouse/dashboard.tsx": 51,
  "client/src/pages/workflows/documents.tsx": 19,
  "client/src/pages/workflows/index.tsx": 35,
  "client/src/pages/workflows/vehicle-acquisition.tsx": 58,
  "client/src/pages/workshop-manager/dashboard.tsx": 41,
  "client/src/services/alertsService.ts": 16,
  "client/src/services/billingService.ts": 6,
  "client/src/services/clientBillingService.ts": 16,
  "client/src/services/fuelCardService.ts": 6,
  "client/src/services/maintenanceService.ts": 18,
  "client/src/services/partsService.ts": 16,
  "client/src/services/vehiclesService.ts": 12,
  "client/src/services/warehouseService.ts": 6,
};

const counts = () => {
  const out: Record<string, number> = {};
  for (const f of walk(resolve(root, "client/src"))) {
    const n = count(readFileSync(f, "utf8"));
    if (n) out[relative(root, f).split(sep).join("/")] = n;
  }
  return out;
};

describe("palette Tailwind et surfaces en dur dans client/src", () => {
  it("aucun fichier ne depasse son compte gele (nouveau fichier = 0)", () => {
    expect(Object.entries(counts()).filter(([f, n]) => n > (GELES[f] ?? 0))).toEqual([]);
  });

  it("chaque fichier gele est a son compte exact (compte baisse : abaisser GELES)", () => {
    const now = counts();
    const ecarts = Object.keys(GELES)
      .filter((f) => (now[f] ?? 0) !== GELES[f])
      .map((f) => `${f} : gele ${GELES[f]}, actuel ${now[f] ?? 0} -> compte baisse : abaisser GELES (ou retirer le fichier)`);
    expect(ecarts).toEqual([]);
  });

  it("le detecteur voit palette, variantes et surfaces en dur, pas les jetons ni les gris", () => {
    expect(count('<p className="text-red-600 dark:text-red-400 bg-green-50/50 hover:bg-amber-100 border-blue-200">')).toBe(5);
    expect(count('<div className="bg-white text-black from-purple-500 to-pink-600">')).toBe(4);
    expect(count('<div className="bg-card text-foreground text-destructive-text bg-gray-50 text-slate-500 text-white bg-black">')).toBe(0);
    expect(count('<div className="my-bg-white text-red-600x">')).toBe(0);
  });
});
