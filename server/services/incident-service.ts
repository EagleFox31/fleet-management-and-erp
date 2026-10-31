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
import { and, desc, eq, inArray } from "drizzle-orm";
import { assignments, drivers, incidents, users } from "@shared/schema";
import type { CreateIncidentRequest, Incident, IncidentStatus } from "@shared/contracts/incidents";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("incidents");

export type IncidentActor = { id: number; role: string };

/** Affectations qui rattachent encore un chauffeur à son véhicule. */
export const ACTIVE_ASSIGNMENT_STATUSES = ["pending", "accepted", "in_progress"] as const;

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

async function defaultDeps(): Promise<IncidentDeps> {
  const [{ db }, { storage }] = await Promise.all([import("../db"), import("../storage")]);
  return {
    db,
    assignedVehicleIds: async (actor) => {
      const rows = await db
        .select({ vehicleId: assignments.vehicleId })
        .from(assignments)
        .innerJoin(drivers, eq(assignments.driverId, drivers.id))
        .where(and(eq(drivers.userId, actor.id), inArray(assignments.status, [...ACTIVE_ASSIGNMENT_STATUSES])));
      return rows.map((r: { vehicleId: number | null }) => r.vehicleId).filter((v: number | null): v is number => v !== null);
    },
    notifyRoles: async ({ roles, title, message, link, dedupeKey, priority }) => {
      for (const role of roles) {
        for (const user of await storage.getUsersByRole(role)) {
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

export async function createIncident(
  actor: IncidentActor | undefined,
  input: CreateIncidentRequest,
  deps?: IncidentDeps,
): Promise<Incident> {
  const d = deps ?? (await defaultDeps());
  const assigned = actor?.role === "driver" ? await d.assignedVehicleIds(actor) : [];
  const denied = incidentScopeError(actor, input.vehicleId, assigned);
  if (denied) throw denied;
  const user = actor as IncidentActor;

  const now = (d.now ?? (() => new Date()))();
  const row = await d.db.transaction(async (tx: any) => {
    const [created] = await tx
      .insert(incidents)
      .values({
        vehicleId: input.vehicleId,
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
  });

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
