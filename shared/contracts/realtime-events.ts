/**
 * Événements temps réel du lot recette (ADR 0001 §7).
 *
 * Seul endroit où un nouvel événement se déclare. Nom `<entité>_<participe>`,
 * charge minimale (`{ id, … }`) : le client ré-interroge. La portée part dans
 * `data.scope` de `broadcastUpdate(event, data)` (`server/index.ts`) ; une
 * portée `broadcast` n'est permise que pour un référentiel.
 *
 * Réutilisés sans redéclaration : `work_order_updated` (contrôle qualité),
 * `part_requirement_updated` (réception), `alert_created`.
 */
import {
  FUEL_READ_ROLES,
  GPS_VIEW_ROLES,
  MISSION_ADVISORY_ROLES,
  PART_SALE_READ_ROLES,
  STAFF_ROLES,
  type AppRole,
} from "../constants/roles";

export type RealtimeScope =
  | { type: "broadcast" }
  | { type: "roles"; roles: readonly AppRole[] }
  | { type: "user"; userIds: readonly number[] };

type EventDefinition<TPayload> = {
  /** Portée par défaut ; `user` est résolue à l'émission. */
  scope: RealtimeScope | "user";
  /** Clés de query TanStack à invalider (couche 3, écrans satellites compris). */
  invalidates: readonly string[];
  /** Type porteur, sans valeur à l'exécution. */
  payload?: TPayload;
};

const WORKSHOP_SUPERVISORS = ["admin", "workshop_manager"] as const satisfies readonly AppRole[];

/**
 * Clés de query réelles, pas des préfixes de chemin : TanStack compare les clés élément par
 * élément, `["/api/kpi"]` n'invalide donc pas `["/api/kpi/failures"]`. Chaque entrée est le
 * premier élément d'une `queryKey` posée par un écran
 * (`tests/unit/client/realtime-invalidation-keys.test.ts`).
 */
export const KPI_QUERY_KEYS = [
  "/api/kpi/incidents-per-month",
  "/api/kpi/preventive-compliance",
  "/api/kpi/avg-cost-per-intervention",
  "/api/kpi/maintenance-costs",
  "/api/kpi/failures",
] as const;

/** Écrans du magasin que le stock fait bouger (alertes de réapprovisionnement, valeur, consommation). */
export const WAREHOUSE_QUERY_KEYS = [
  "/api/warehouse/reorder-alerts",
  "/api/warehouse/statistics",
  "/api/warehouse/top-consumed-parts",
  "/api/warehouse/stock-value-history",
  "/api/warehouse/inventory-value",
] as const;

const PART_SALE_INVALIDATES = [
  "/api/part-sales",
  "/api/parts",
  "/api/parts/low-on-stock",
  "/api/parts/statistics",
  ...WAREHOUSE_QUERY_KEYS,
  ...KPI_QUERY_KEYS,
] as const;

export const REALTIME_EVENTS = {
  incident_reported: {
    // Atelier et logistique : les avis de maintenance de mission sont lus par MISSION_ADVISORY_ROLES.
    scope: { type: "roles", roles: [...new Set<AppRole>([...WORKSHOP_SUPERVISORS, ...MISSION_ADVISORY_ROLES])] },
    invalidates: ["/api/incidents", "/api/kpi/incidents-per-month", "/api/alerts", "/api/mission-advisories"],
  } as EventDefinition<{ id: number; vehicleId: number; severity: "low" | "medium" | "high" }>,
  fuel_record_validated: {
    scope: { type: "roles", roles: FUEL_READ_ROLES },
    invalidates: ["/api/fuel-records", "/api/fuel-card", "/api/fuel-vouchers"],
  } as EventDefinition<{ id: number }>,
  fuel_anomaly_resolved: {
    scope: { type: "roles", roles: FUEL_READ_ROLES },
    // Préfixe de `['/api/fuel-card/vehicle', vehicleId, 'anomalies']` (useFuelCard.ts).
    // `/api/fuel-card/anomalies` : liste de l'écran des anomalies.
    invalidates: ["/api/fuel-card/vehicle", "/api/fuel-card/anomalies"],
  } as EventDefinition<{ anomalyKey: string; fuelRecordId: number }>,
  fuel_price_changed: {
    scope: { type: "broadcast" },
    invalidates: ["/api/fuel-prices"],
  } as EventDefinition<{ effectiveFrom: string }>,
  time_tracking_updated: {
    scope: { type: "roles", roles: ["admin", "secretary", "management"] },
    invalidates: ["/api/time-tracking", "/api/time-tracking/monthly-stats"],
  } as EventDefinition<{ userId: number; date: string }>,
  vehicle_document_type_changed: {
    scope: { type: "broadcast" },
    invalidates: ["/api/vehicle-document-types"],
  } as EventDefinition<{ code: string }>,
  backup_failed: {
    scope: { type: "roles", roles: ["admin"] },
    invalidates: ["/api/admin/backups", "/api/admin/backups/alerts"],
  } as EventDefinition<{ id: number }>,

  // Écarts du cahier des charges (chantier CDC, lot CDC-0b). Déclarés ici ; l'émetteur
  // est livré par le lot fonctionnel concerné.
  // Vente de pièces : le stock, l'entrepôt et les tuiles KPI changent avec la vente.
  part_sale_validated: {
    scope: { type: "roles", roles: PART_SALE_READ_ROLES },
    invalidates: PART_SALE_INVALIDATES,
  } as EventDefinition<{ id: number }>,
  part_sale_cancelled: {
    scope: { type: "roles", roles: PART_SALE_READ_ROLES },
    invalidates: PART_SALE_INVALIDATES,
  } as EventDefinition<{ id: number }>,
  part_sale_invoiced: {
    scope: { type: "roles", roles: PART_SALE_READ_ROLES },
    invalidates: PART_SALE_INVALIDATES,
  } as EventDefinition<{ id: number; invoiceId: number }>,
  vehicle_position_updated: {
    scope: { type: "roles", roles: GPS_VIEW_ROLES },
    invalidates: ["/api/vehicle-positions"],
  } as EventDefinition<{ vehicleId: number }>,
  // Import Excel appliqué : véhicules, ordres de travail et KPI changent. Sans toast.
  import_batch_applied: {
    // Tout le personnel lit les véhicules et les ordres de travail (AGENTS.md section 11) ;
    // le client est exclu, il revoit ses véhicules à sa prochaine navigation.
    scope: { type: "roles", roles: STAFF_ROLES },
    invalidates: ["/api/vehicles", "/api/work-orders", ...KPI_QUERY_KEYS],
  } as EventDefinition<{ batchId: number; kind: string }>,
} as const;

export type RealtimeEventName = keyof typeof REALTIME_EVENTS;

export type RealtimeEventPayload<E extends RealtimeEventName> = NonNullable<(typeof REALTIME_EVENTS)[E]["payload"]>;

export const REALTIME_EVENT_NAMES = Object.keys(REALTIME_EVENTS) as RealtimeEventName[];

/** Événements existants que le lot réutilise ; un nom du lot ne doit pas les redéclarer. */
export const REUSED_REALTIME_EVENTS = ["work_order_updated", "part_requirement_updated", "alert_created"] as const;
