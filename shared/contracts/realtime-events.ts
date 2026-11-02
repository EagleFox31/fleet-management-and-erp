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
import { FUEL_READ_ROLES, type AppRole } from "../constants/roles";

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

export const REALTIME_EVENTS = {
  incident_reported: {
    scope: { type: "roles", roles: WORKSHOP_SUPERVISORS },
    invalidates: ["/api/incidents", "/api/kpi/incidents-per-month", "/api/alerts"],
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
  alerts_read: {
    // Nominatif : les autres onglets du même compte remettent cloche et compteur à jour.
    scope: "user",
    invalidates: ["/api/alerts", "/api/alerts/unread", "/api/alerts/active", "/api/alerts/count"],
  } as EventDefinition<{ alertIds: number[] }>,
  backup_failed: {
    scope: { type: "roles", roles: ["admin"] },
    invalidates: ["/api/admin/backups", "/api/admin/backups/alerts"],
  } as EventDefinition<{ id: number }>,
} as const;

export type RealtimeEventName = keyof typeof REALTIME_EVENTS;

export type RealtimeEventPayload<E extends RealtimeEventName> = NonNullable<(typeof REALTIME_EVENTS)[E]["payload"]>;

export const REALTIME_EVENT_NAMES = Object.keys(REALTIME_EVENTS) as RealtimeEventName[];

/** Événements existants que le lot réutilise ; un nom du lot ne doit pas les redéclarer. */
export const REUSED_REALTIME_EVENTS = ["work_order_updated", "part_requirement_updated", "alert_created"] as const;
