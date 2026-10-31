/**
 * Composants des écrans CDC, par id de `cdc-screens.ts`. Pages chargées à la demande : une
 * entrée absente retombe sur `ScreenPlaceholder` (`lot-routes.tsx`).
 *
 * Un lot fonctionnel remplit le fichier `pages/cdc/<id>.tsx` de son écran et ne touche pas
 * cette table, sauf pour pointer vers un autre composant.
 */
import { lazy, type ComponentType } from "react";
import type { LotScreenComponentProps } from "@/config/lot-screen-components";

export const CDC_SCREEN_COMPONENTS: Partial<Record<string, ComponentType<LotScreenComponentProps>>> = {
  "part-scanner": lazy(() => import("@/pages/cdc/part-scanner")),
  "part-labels": lazy(() => import("@/pages/cdc/part-labels")),
  "part-sales": lazy(() => import("@/pages/cdc/part-sales")),
  "fleet-map": lazy(() => import("@/pages/cdc/fleet-map")),
  "telemetry-devices": lazy(() => import("@/pages/cdc/telemetry-devices")),
  "kpi-reports": lazy(() => import("@/pages/cdc/kpi-reports")),
  "maintenance-report": lazy(() => import("@/pages/cdc/maintenance-report")),
  "excel-import": lazy(() => import("@/pages/cdc/excel-import")),
};
