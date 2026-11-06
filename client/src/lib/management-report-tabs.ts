import type { FeatureKey } from "@shared/feature-flags";
import { FEATURE_GATED_HREFS } from "@/config/lot-screens";

/**
 * Onglets de /management/reports.
 *
 * Un onglet dont le chemin est derrière un drapeau (`FEATURE_GATED_HREFS`, la table que lit
 * aussi la barre latérale) disparaît quand le drapeau est éteint. Une URL directe vers un
 * onglet masqué retombe sur l'onglet par défaut : jamais d'onglet vide.
 */
export type ReportTabId = "board_pack" | "finance" | "fleet" | "drivers" | "scheduled";

export interface ReportTabDef {
  value: ReportTabId;
  label: string;
  path: string;
}

export const DEFAULT_REPORT_TAB: ReportTabId = "board_pack";

export const REPORT_TAB_DEFS: readonly ReportTabDef[] = [
  { value: "board_pack", label: "Board Pack Stratégique", path: "/management/reports/board-pack" },
  { value: "finance", label: "Trésorerie & Recouvrement", path: "/management/reports/finance" },
  { value: "fleet", label: "Audit Flotte & TCO", path: "/management/reports/fleet" },
  { value: "drivers", label: "Performance Chauffeurs", path: "/management/reports/drivers" },
  { value: "scheduled", label: "Distribution & Envois", path: "/management/reports/scheduled" },
];

export type FeatureFlagValues = Readonly<Record<FeatureKey, boolean>>;

export function isReportTabEnabled(tab: Pick<ReportTabDef, "path">, flags: FeatureFlagValues): boolean {
  const gate = FEATURE_GATED_HREFS[tab.path];
  return !gate || flags[gate];
}

export function visibleReportTabs<T extends Pick<ReportTabDef, "path">>(tabs: readonly T[], flags: FeatureFlagValues): T[] {
  return tabs.filter((tab) => isReportTabEnabled(tab, flags));
}

/** Onglet affiché pour une URL : celui qu'elle désigne s'il est visible, sinon l'onglet par défaut. */
export function reportTabForLocation(location: string, flags: FeatureFlagValues): ReportTabId {
  const tab = REPORT_TAB_DEFS.find(
    (t) => t.value !== DEFAULT_REPORT_TAB && (location === t.path || location.startsWith(`${t.path}/`)),
  );
  return tab && isReportTabEnabled(tab, flags) ? tab.value : DEFAULT_REPORT_TAB;
}
