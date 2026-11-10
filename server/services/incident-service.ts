/**
 * Déclaration de panne (T-43, P-22). Drapeau `incidents`.
 *
 * - règle de périmètre : un chauffeur ne déclare que pour un véhicule qui lui
 *   est affecté (mission en cours via `assignments`) ; un client ne déclare
 *   rien ; le personnel déclare pour tout véhicule ;
 * - insertion avec les champs d'audit (`created_by`, `updated_by`) ;
 * - après l'insertion : alerte au chef d'atelier et à l'admin (dédupliquée par
 *   `dedupe_key`, donc un retry est sans doublon) puis événement
 *   `incident_reported` (roles workshop_manager et admin).
 *
 * Le routeur (`server/api/incidents.routes.ts`) est à l'API : il appelle
 * `createIncident(user, body)` et `listIncidents(user, query)`.
 */
import { and, desc, eq } from "drizzle-orm";
import { incidents, users, vehicles, workOrders, type WorkOrder } from "@shared/schema";
import type { CreateIncidentRequest, Incident, IncidentStatus } from "@shared/contracts/incidents";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@shared/constants/assignments";
import { STATUS_MESSAGES } from "@shared/errors";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { workOrderCostScope } from "../lib/work-order-realtime-scope";

const log = moduleLogger("incidents");

/** Réexport : la liste vit dans `@shared/constants/assignments`, partagée avec l'écran de déclaration. */
export { ACTIVE_ASSIGNMENT_STATUSES };

export type IncidentActor = { id: number; role: string };

export const INCIDENT_OUT_OF_SCOPE_MESSAGE = "Vous ne pouvez déclarer une panne que sur le véhicule qui vous est affecté.";
export const INCIDENT_FORBIDDEN_MESSAGE = "Votre profil ne permet pas de déclarer une panne.";

/**
 * Règle pure. `assignedVehicleIds` n'est lu que pour un chauffeur.
 * Renvoie une AppError 403 à lever, ou null si la déclaration est permise.
 */
export function incidentScopeError(
  actor: IncidentActor | undefined,
  vehicleId: number,
  assignedVehicleIds: readonly number[],
): AppError | null {
  if (!actor) return new AppError(401, "Non authentifié.");
  if (actor.role === "client") return new AppError(403, INCIDENT_FORBIDDEN_MESSAGE);
  if (actor.role === "driver" && !assignedVehicleIds.includes(vehicleId)) {
    return new AppError(403, INCIDENT_OUT_OF_SCOPE_MESSAGE);
  }
  return null;
}

export interface IncidentDeps {
  db: any;
  /** Véhicules affectés au chauffeur (user). */
  assignedVehicleIds: (actor: IncidentActor) => Promise<number[]>;
  /** Alerte nominative ; renvoie l'id créé. Idempotente par `dedupeKey`. */
  notifyRoles: (params: { roles: string[]; title: string; message: string; link: string; dedupeKey: string; priority: "high" | "medium" }) => Promise<void>;
  broadcast: (event: string, data: Record<string, unknown>) => void;
  now?: () => Date;
}

export async function defaultDeps(): Promise<IncidentDeps> {
  const [{ db }, { storage }, { assignedVehicleIdsOf }, { usersByRolesBestEffort }] = await Promise.all([
    import("../db"),
    import("../storage"),
    import("../lib/driver-scope"),
    import("../lib/alert-recipients"),
  ]);
  return {
    db,
    assignedVehicleIds: assignedVehicleIdsOf,
    notifyRoles: async ({ roles, title, message, link, dedupeKey, priority }) => {
      // Un rôle illisible est journalisé et ignoré : les autres rôles restent notifiés.
      for (const role of roles) {
        for (const user of await usersByRolesBestEffort([role], log, { dedupeKey })) {
          try {
            const created = await storage.createAlert({
              userId: user.id,
              title,
              message,
              type: "maintenance",
              priority,
              link,
              topic: "incident",
              dedupeKey,
            });
            const broadcast = (global as any).broadcastUpdate;
            if (typeof broadcast === "function" && created?.id) {
              broadcast("alert_created", {
                entity: "alert",
                entityId: created.id,
                payload: { alertId: created.id, userId: user.id, title, message, type: "maintenance", priority, link },
                scope: { type: "user", userIds: [user.id] },
              });
            }
          } catch (err) {
            // Doublon sur l'index unique (retry) ou panne d'alerte : la déclaration reste valide.
            log.warn({ err, userId: user.id, dedupeKey }, "alerte d'incident non créée");
          }
        }
      }
    },
    broadcast: (event, data) => {
      const fn = (global as any).broadcastUpdate;
      if (typeof fn === "function") fn(event, data);
    },
  };
}

function toIncident(row: typeof incidents.$inferSelect, reportedByName: string | null): Incident {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    reportedBy: row.reportedBy,
    reportedByName,
    description: row.description,
    severity: row.severity,
    status: row.status,
    workOrderId: row.workOrderId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface CreateIncidentOptions {
  /**
   * Ouvre dans la même transaction un OT `pending` lié à la déclaration (`incidents.work_order_id`)
   * et émet `work_order_created`. Faux par défaut : la route historique `/api/incidents` ne crée pas d'OT.
   */
  openWorkOrder?: boolean;
}

const WORK_ORDER_PRIORITY = { low: "low", medium: "medium", high: "high" } as const;

/**
 * Échec d'une étape antérieure à toute écriture validée (lecture du périmètre, transaction) :
 * 404 si la clé étrangère du véhicule saute (course avec une suppression), sinon 503 lisible.
 * Les deux codes figurent dans `PRE_WRITE_REFUSAL_CODES` : la clé d'idempotence est libérée, le
 * réessai avec la même clé peut écrire. Une `AppError` déjà prononcée passe telle quelle.
 */
function preWriteFailure(err: unknown): never {
  if (err instanceof AppError) throw err;
  if ((err as { code?: unknown } | null)?.code === "23503") {
    throw new AppError(404, "Véhicule introuvable.", { cause: err, code: "INCIDENT_VEHICLE_NOT_FOUND" });
  }
  throw new AppError(503, STATUS_MESSAGES.INCIDENT_WRITE_FAILED, { cause: err, code: "INCIDENT_WRITE_FAILED" });
}

export async function createIncident(
  actor: IncidentActor | undefined,
  input: CreateIncidentRequest,
  deps?: IncidentDeps,
  options: CreateIncidentOptions = {},
): Promise<Incident> {
  const d = deps ?? (await defaultDeps());
  const assigned = actor?.role === "driver" ? await d.assignedVehicleIds(actor).catch(preWriteFailure) : [];
  const denied = incidentScopeError(actor, input.vehicleId, assigned);
  if (denied) throw denied;
  const user = actor as IncidentActor;

  const now = (d.now ?? (() => new Date()))();
  let workOrder: WorkOrder | null = null;
  const row = await d.db.transaction(async (tx: any) => {
    const [vehicle] = await tx
      .select({
        id: vehicles.id,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        deletedAt: vehicles.deletedAt,
      })
      .from(vehicles)
      .where(eq(vehicles.id, input.vehicleId))
      .limit(1);
    // Véhicule inexistant : 404 lisible (et non la violation de clé étrangère de l'incident, un 500).
    if (!vehicle) throw new AppError(404, "Véhicule introuvable.", { code: "INCIDENT_VEHICLE_NOT_FOUND" });
    if (options.openWorkOrder) {
      if (vehicle.deletedAt) throw new AppError(404, "Véhicule introuvable.", { code: "INCIDENT_VEHICLE_NOT_FOUND" });
      const [order] = await tx
        .insert(workOrders)
        .values({
          vehicleId: vehicle.id,
          vehicleRegistration: vehicle.registrationNumber,
          vehicleBrand: vehicle.brand,
          vehicleModel: vehicle.model,
          title: `Panne déclarée : ${vehicle.registrationNumber}`,
          description: input.description,
          status: "pending",
          priority: WORK_ORDER_PRIORITY[input.severity],
          createdBy: user.id,
          updatedBy: user.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      workOrder = order as WorkOrder;
    }
    const [created] = await tx
      .insert(incidents)
      .values({
        vehicleId: input.vehicleId,
        workOrderId: (workOrder as WorkOrder | null)?.id ?? null,
        reportedBy: user.id,
        description: input.description,
        severity: input.severity,
        status: "open",
        createdBy: user.id,
        updatedBy: user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return created as typeof incidents.$inferSelect;
  }).catch(preWriteFailure);

  // Après validation de la transaction : l'alerte ne peut pas annoncer un incident absent.
  await d
    .notifyRoles({
      roles: ["workshop_manager", "admin"],
      title: input.severity === "high" ? "Panne grave déclarée" : "Panne déclarée",
      message: `Panne ${input.severity === "high" ? "grave " : ""}déclarée sur le véhicule #${input.vehicleId}.`,
      link: "/incidents",
      dedupeKey: `incident_reported:${row.id}`,
      priority: input.severity === "high" ? "high" : "medium",
    })
    .catch((err) => log.error({ err, incidentId: row.id }, "alerte d'incident en échec"));

  d.broadcast("incident_reported", {
    entity: "incident",
    entityId: row.id,
    payload: { id: row.id, vehicleId: row.vehicleId, severity: row.severity },
    scope: { type: "roles", roles: ["workshop_manager", "admin"] },
  });

  if (workOrder) {
    const opened = workOrder as WorkOrder;
    d.broadcast("work_order_created", {
      entity: "work_order",
      entityId: opened.id,
      workOrderId: opened.id,
      workOrder: opened,
      source: "driver_breakdown",
      incidentId: row.id,
      triggeredBy: user.id,
      actor: { userId: user.id },
      scope: workOrderCostScope(),
    });
  }

  return toIncident(row, null);
}

export async function listIncidents(
  actor: IncidentActor | undefined,
  query: { status?: IncidentStatus },
  deps?: Pick<IncidentDeps, "db">,
): Promise<Incident[]> {
  if (!actor) throw new AppError(401, "Non authentifié.");
  if (actor.role === "client") throw new AppError(403, INCIDENT_FORBIDDEN_MESSAGE);
  const db = (deps ?? (await defaultDeps())).db;
  const filters = [
    query.status ? eq(incidents.status, query.status) : undefined,
    // Un chauffeur ne relit que ses propres déclarations.
    actor.role === "driver" ? eq(incidents.reportedBy, actor.id) : undefined,
  ].filter((f) => f !== undefined);
  const rows = await db
    .select({ incident: incidents, name: users.name })
    .from(incidents)
    .leftJoin(users, eq(incidents.reportedBy, users.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(incidents.createdAt));
  return rows.map((r: { incident: typeof incidents.$inferSelect; name: string | null }) => toIncident(r.incident, r.name));
}
