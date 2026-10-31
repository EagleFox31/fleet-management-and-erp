import {
  GPS_VIEW_ROLES,
  IMPORT_INTERVENTION_ROLES,
  IMPORT_ROLES,
  MAINTENANCE_REPORT_ROLES,
  MISSION_ADVISORY_ROLES,
  PART_SALE_READ_ROLES,
  PART_SALE_ROLES,
  PART_SCAN_ROLES,
  type AppRole,
} from "../../shared/constants/roles";
import type { FeatureKey } from "../../shared/feature-flags";

/**
 * Montages du lot CDC-0a (server/api/index.ts), partagés par le test sans base
 * (tests/unit/server/cdc-mounts.test.ts) et le contrat avec sessions réelles
 * (tests/contract/cdc-mounts.contract.test.ts).
 *
 * `flags` : tous requis pour que la route existe ; coupés un à un, la route répond 404.
 * `allowed` : rôles qui atteignent le squelette (501) ; tout autre rôle reçoit 403.
 */
export type MountCase = {
  name: string;
  method: "GET" | "POST";
  path: string;
  flags: readonly FeatureKey[];
  allowed: readonly AppRole[];
};

export const MOUNT_CASES: readonly MountCase[] = [
  { name: "mission-advisories", method: "GET", path: "/api/mission-advisories", flags: ["mission-maintenance-advisory"], allowed: MISSION_ADVISORY_ROLES },
  { name: "part-scans", method: "GET", path: "/api/part-scans", flags: ["part-qr"], allowed: PART_SCAN_ROLES },
  { name: "part-sales (lecture)", method: "GET", path: "/api/part-sales", flags: ["part-sales"], allowed: PART_SALE_READ_ROLES },
  { name: "part-sales (écriture)", method: "POST", path: "/api/part-sales", flags: ["part-sales"], allowed: PART_SALE_ROLES },
  { name: "vehicle-positions", method: "GET", path: "/api/vehicle-positions", flags: ["gps"], allowed: GPS_VIEW_ROLES },
  { name: "admin/telemetry-devices", method: "GET", path: "/api/admin/telemetry-devices", flags: ["gps"], allowed: ["admin"] },
  // Provisoire jusqu'au lot #6 (jeton d'appareil) : administrateur seulement, jamais sans session.
  { name: "telemetry", method: "POST", path: "/api/telemetry/positions", flags: ["gps"], allowed: ["admin"] },
  { name: "workshop-labor-rates", method: "GET", path: "/api/workshop-labor-rates", flags: ["maintenance-report"], allowed: ["admin"] },
  // `exports` est allumé par défaut : les tests le coupent explicitement.
  { name: "maintenance-reports", method: "GET", path: "/api/maintenance-reports", flags: ["exports", "maintenance-report"], allowed: MAINTENANCE_REPORT_ROLES },
  { name: "imports (interventions)", method: "POST", path: "/api/imports/interventions", flags: ["excel-import"], allowed: IMPORT_INTERVENTION_ROLES },
  { name: "imports (autres types)", method: "POST", path: "/api/imports/parts", flags: ["excel-import"], allowed: IMPORT_ROLES },
];
