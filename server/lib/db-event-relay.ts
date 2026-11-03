/**
 * Relais des notifications Postgres (`fleet_events`) vers le WebSocket (AGENTS.md §11).
 *
 * Les triggers ne relaient que des changements d'OT : `work_order_*` et `vehicle_status_changed`
 * (véhicule immobilisé ou libéré par un OT).
 * - `work_order_*` porte l'OT (titre, technicien) : `workOrderCostScope()`, donc ni client ni chauffeur.
 * - `vehicle_status_changed` part au personnel en entier, puis au propriétaire du véhicule en trame
 *   réduite `{ vehicleId, status }`, sans acteur : la fiche véhicule du client s'actualise.
 *   Propriétaire nul ou lecture en échec : rien n'est envoyé au client.
 */
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { vehicles } from "@shared/schema";
import { db } from "../db";
import { moduleLogger } from "./logger";
import { workOrderCostScope, workOrderStaffScope } from "./work-order-realtime-scope";

const log = moduleLogger("db-event-relay");

export interface DatabaseRealtimeMessage {
  source?: string;
  version?: number;
  entity?: string;
  entityId?: number | string | null;
  eventType?: string;
  payload?: unknown;
  emittedAt?: string;
}

type Broadcast = (event: string, data: Record<string, unknown>) => void;

export interface RelayDeps {
  broadcast: Broadcast;
  inferEntity: (event: string) => string;
  /** Propriétaire d'un véhicule ; lève en cas d'échec. Par défaut : une requête sur `vehicles`. */
  readOwnerId?: (vehicleId: number) => Promise<number | null>;
}

const positiveInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

async function defaultReadOwnerId(vehicleId: number): Promise<number | null> {
  const [row] = await db.select({ ownerId: vehicles.ownerId }).from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  return row?.ownerId ?? null;
}

export async function relayDatabaseEvent(parsed: DatabaseRealtimeMessage, deps: RelayDeps): Promise<void> {
  if (typeof parsed.eventType !== "string") return;
  const eventType = parsed.eventType;
  const payload =
    parsed.payload && typeof parsed.payload === "object" && !Array.isArray(parsed.payload)
      ? (parsed.payload as Record<string, unknown>)
      : {};
  const entityId = parsed.entityId ?? positiveInteger(payload.workOrderId) ?? positiveInteger(payload.vehicleId) ?? null;
  const emittedAt = typeof parsed.emittedAt === "string" ? parsed.emittedAt : new Date().toISOString();
  const entity = typeof parsed.entity === "string" ? parsed.entity : deps.inferEntity(eventType);

  deps.broadcast(eventType, {
    version: typeof parsed.version === "number" ? parsed.version : 1,
    entity,
    entityId,
    payload,
    scope: eventType.startsWith("work_order") ? workOrderCostScope() : workOrderStaffScope(),
    actor: null,
    emittedAt,
    correlationId: randomUUID(),
    causationId: null,
    tenantId: null,
  });

  if (eventType !== "vehicle_status_changed") return;
  const vehicleId = positiveInteger(payload.vehicleId);
  if (!vehicleId) return;
  try {
    const ownerId = await (deps.readOwnerId ?? defaultReadOwnerId)(vehicleId);
    if (!ownerId) return;
    deps.broadcast(eventType, {
      version: 1,
      entity: "vehicle",
      entityId: vehicleId,
      payload: { vehicleId, status: payload.status ?? null },
      scope: { type: "user", userIds: [ownerId] },
      actor: null,
      emittedAt,
      correlationId: randomUUID(),
      causationId: null,
      tenantId: null,
    });
  } catch (err) {
    log.error({ err, vehicleId }, "propriétaire du véhicule illisible : trame réduite non envoyée");
  }
}
