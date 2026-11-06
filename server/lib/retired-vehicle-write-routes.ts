import { MAX_DB_INTEGER_ID } from "@shared/contracts/common";

/**
 * Écritures rattachées à un véhicule (L3) : refusées en 409 (`VEHICLE_RETIRED_EDIT_MESSAGE`) quand le
 * véhicule visé est retiré. Saisie tardive : restaurer, saisir, retirer de nouveau (décision 0a, option A).
 *
 * Table déclarative, sans accès base : la garde (`server/middleware/retired-vehicle-write-guard.ts`)
 * la lit, et `tests/unit/server/retired-vehicle-writes-hygiene.test.ts` vérifie que toute écriture qui
 * porte un véhicule y figure (ou appelle `assertVehicleWritable` dans sa poignée).
 *
 * Source du véhicule, plusieurs possibles par route (un seul retiré suffit à refuser) :
 * - `body` : identifiant du véhicule dans le corps (chemin pointé : `rotation.vehicleId`) ;
 * - `param` : identifiant du véhicule dans le chemin ;
 * - `lookup` + `param` / `body` : objet rattaché dont on lit le véhicule (OT, plein, pneu monté…).
 * Identifiant absent ou illisible : la garde laisse passer, la route répond 400 ou 404 comme avant.
 */
export type VehicleLookup =
  | "workOrder"
  | "maintenanceSchedule"
  | "fuelRecord"
  | "vehicleTire"
  | "vehicleDocument"
  | "renewalRequest"
  | "partUsed"
  | "workOrderItem"
  | "partRequirement";

export type VehicleSource =
  | { body: string }
  | { param: string }
  | { lookup: VehicleLookup; param: string }
  | { lookup: VehicleLookup; body: string };

export type RetiredVehicleWriteRoute = { route: string; vehicle: VehicleSource[] };

const wo = (param = "id"): VehicleSource => ({ lookup: "workOrder", param });

export const RETIRED_VEHICLE_WRITE_ROUTES: readonly RetiredVehicleWriteRoute[] = [
  // Maintenance et OT
  { route: "POST /api/maintenance-schedules", vehicle: [{ body: "vehicleId" }] },
  { route: "POST /api/maintenance-schedules/:id/generate-work-order", vehicle: [{ lookup: "maintenanceSchedule", param: "id" }] },
  { route: "PATCH /api/maintenance-schedules/:id", vehicle: [{ lookup: "maintenanceSchedule", param: "id" }, { body: "vehicleId" }] },
  { route: "DELETE /api/maintenance-schedules/:id", vehicle: [{ lookup: "maintenanceSchedule", param: "id" }] },
  { route: "POST /api/test-date-maintenance", vehicle: [{ body: "vehicleId" }] },
  { route: "POST /api/work-orders", vehicle: [{ body: "vehicleId" }] },
  { route: "PATCH /api/work-orders/:id", vehicle: [wo(), { body: "vehicleId" }] },
  { route: "DELETE /api/work-orders/:id", vehicle: [wo()] },
  { route: "PATCH /api/technician/work-orders/:id/status", vehicle: [wo()] },
  { route: "POST /api/work-orders/:id/quality-check", vehicle: [wo()] },
  { route: "POST /api/work-orders/:workOrderId/items", vehicle: [wo("workOrderId")] },
  { route: "PATCH /api/work-order-items/:id", vehicle: [{ lookup: "workOrderItem", param: "id" }] },
  { route: "DELETE /api/work-order-items/:id", vehicle: [{ lookup: "workOrderItem", param: "id" }] },
  { route: "POST /api/work-orders/:workOrderId/awaiting-parts", vehicle: [wo("workOrderId")] },
  { route: "POST /api/work-orders/:workOrderId/parts", vehicle: [wo("workOrderId")] },
  { route: "POST /api/work-orders/:workOrderId/part-requirements/:requirementId/issue", vehicle: [wo("workOrderId")] },
  { route: "DELETE /api/parts-used/:id", vehicle: [{ lookup: "partUsed", param: "id" }] },
  { route: "POST /api/part-requirements", vehicle: [{ body: "vehicleId" }, { lookup: "workOrder", body: "workOrderId" }] },
  {
    route: "PATCH /api/part-requirements/:id",
    vehicle: [{ lookup: "partRequirement", param: "id" }, { body: "vehicleId" }, { lookup: "workOrder", body: "workOrderId" }],
  },
  { route: "DELETE /api/part-requirements/:id", vehicle: [{ lookup: "partRequirement", param: "id" }] },
  // Carburant
  { route: "POST /api/fuel-records", vehicle: [{ body: "vehicleId" }] },
  { route: "PATCH /api/fuel-records/:id", vehicle: [{ lookup: "fuelRecord", param: "id" }, { body: "vehicleId" }] },
  { route: "DELETE /api/fuel-records/:id", vehicle: [{ lookup: "fuelRecord", param: "id" }] },
  { route: "POST /api/fuel-card/consumption", vehicle: [{ body: "vehicleId" }] },
  { route: "POST /api/missions/:id/fuel-records", vehicle: [{ body: "vehicleId" }] },
  { route: "POST /api/missions/:id/fuel-records/regularize", vehicle: [{ body: "vehicleId" }] },
  { route: "POST /api/fuel-vouchers/:id/validate", vehicle: [{ lookup: "fuelRecord", param: "id" }] },
  { route: "POST /api/operations/missions/from-fuel", vehicle: [{ lookup: "fuelRecord", body: "fuelRecordId" }] },
  // Kilométrage, position, documents
  { route: "POST /api/vehicles/:id/mileage/sync", vehicle: [{ param: "id" }] },
  { route: "PUT /api/vehicles/:id/mileage", vehicle: [{ param: "id" }] },
  { route: "PUT /api/vehicles/:id/maintenance-position", vehicle: [{ param: "id" }] },
  { route: "POST /api/vehicles/:vehicleId/documents", vehicle: [{ param: "vehicleId" }] },
  { route: "PATCH /api/documents/:id", vehicle: [{ lookup: "vehicleDocument", param: "id" }] },
  { route: "DELETE /api/documents/:id", vehicle: [{ lookup: "vehicleDocument", param: "id" }] },
  { route: "POST /api/document-renewals/requests", vehicle: [{ body: "vehicleId" }] },
  { route: "PATCH /api/document-renewals/requests/:id/status", vehicle: [{ lookup: "renewalRequest", param: "id" }] },
  { route: "POST /api/document-renewals/requests/:id/receipt", vehicle: [{ lookup: "renewalRequest", param: "id" }] },
  // Pneus (démontage `PATCH /api/vehicle-tires/:id/remove` laissé ouvert : récupérer les pneus en stock)
  { route: "POST /api/vehicles/:vehicleId/tires", vehicle: [{ param: "vehicleId" }] },
  { route: "PATCH /api/vehicle-tires/:id", vehicle: [{ lookup: "vehicleTire", param: "id" }] },
  { route: "POST /api/tire-inspections", vehicle: [{ lookup: "vehicleTire", body: "vehicleTireId" }] },
  { route: "POST /api/tire-rotations", vehicle: [{ body: "rotation.vehicleId" }] },
  // Exploitation
  { route: "POST /api/incidents", vehicle: [{ body: "vehicleId" }] },
  { route: "POST /api/driver/breakdowns", vehicle: [{ body: "vehicleId" }] },
  { route: "POST /api/qhse/inspections", vehicle: [{ body: "vehicleId" }] },
];

/**
 * `METHODE /api/a/:x` → méthode Express et chemin relatif à `apiRouter` (`/a/:x`). La garde déclare
 * chaque entrée dans un routeur Express : casse, décodage `%xx`, barre finale et paramètres sont
 * ceux des routes elles-mêmes (une expression maison divergeait, cf. audit L3).
 */
export function routeParts(route: string): { method: "post" | "put" | "patch" | "delete"; path: string } {
  const [method, path] = route.split(" ");
  const lower = method.toLowerCase();
  if (!["post", "put", "patch", "delete"].includes(lower) || !path.startsWith("/api/")) {
    throw new Error(`Entrée de RETIRED_VEHICLE_WRITE_ROUTES illisible : ${route}`);
  }
  return { method: lower as "post" | "put" | "patch" | "delete", path: path.slice("/api".length) };
}

/**
 * Identifiant de véhicule ou d'objet, lu au moins aussi largement que les routes (`z.coerce.number`,
 * `Number()` des formulaires : `" 7"`, `"7.0"`, `"+7"`, `[7]`) : refuser une valeur que la route
 * accepterait laisserait passer l'écriture. Entier de 1 à `MAX_DB_INTEGER_ID` (au-delà, la colonne
 * `integer` lèverait une erreur) ; sinon null, la route valide elle-même.
 */
export function asVehicleRef(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === "object" && !Array.isArray(value)) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= MAX_DB_INTEGER_ID ? n : null;
}

/** Valeur d'un chemin pointé (`rotation.vehicleId`) dans le corps. */
export function readBodyPath(body: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), body);
}
