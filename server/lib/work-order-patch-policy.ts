import { z } from "zod";
import { workOrders, type WorkOrder } from "@shared/schema";
import type { ApiFieldError } from "@shared/errors";
import { AppError } from "./app-error";
import { prepareColumnUpdate } from "./column-validation";

/**
 * Colonnes qu'un rôle peut écrire par `PATCH /api/work-orders/:id` (modification générique).
 *
 * Tout le reste est refusé (403), notamment ce que le serveur pose seul : `id`, `createdBy`,
 * `createdAt`, `updatedBy`, `updatedAt`, `cost` (calculé à partir des travaux et pièces) et
 * `vehicleId`. Le véhicule d'un OT ne change pas, même pour l'admin : les pièces posées, les
 * travaux et l'immobilisation du véhicule suivent l'OT. On l'annule et on en crée un autre.
 *
 * Le technicien n'agit que sur un OT qui lui est assigné, et seulement pour démarrer ou
 * terminer (statut et dates, `work-orders/[id].tsx`). L'affectation relève du chef d'atelier.
 */
const MANAGER_FIELDS = [
  "title",
  "description",
  "diagnosis",
  "status",
  "priority",
  "startDate",
  "endDate",
  "duration",
  "technicianId",
  "isPreventive",
  "isFirstVisit",
  "maintenanceScheduleId",
] as const;

type WorkOrderPatchField = (typeof MANAGER_FIELDS)[number];

export const WORK_ORDER_PATCH_FIELDS_BY_ROLE: Readonly<Record<string, readonly WorkOrderPatchField[]>> = {
  admin: MANAGER_FIELDS,
  workshop_manager: MANAGER_FIELDS,
  technician: ["status", "startDate", "endDate"],
};

/**
 * Copies du véhicule que le formulaire d'édition renvoie avec le reste : le serveur les tient,
 * elles ne sont jamais écrites par ce chemin. Ignorées plutôt que refusées, pour ne pas casser
 * l'enregistrement du formulaire quand la fiche véhicule a changé depuis la création de l'OT.
 */
const VEHICLE_COPIES = ["vehicleRegistration", "vehicleBrand", "vehicleModel"] as const;

const positiveId = z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).nullable();
const dateValue = z.union([z.string(), z.date()]).nullable();

/** Liste blanche Zod : forme de chaque colonne permise (types déjà contrôlés par `prepareColumnUpdate`). */
const FIELD_SCHEMAS = {
  title: z.string().trim().min(1, "Le titre est obligatoire."),
  description: z.string().nullable(),
  diagnosis: z.string().nullable(),
  status: z.enum(workOrders.status.enumValues),
  priority: z.enum(workOrders.priority.enumValues),
  startDate: dateValue,
  endDate: dateValue,
  duration: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).nullable(),
  technicianId: positiveId,
  isPreventive: z.boolean(),
  isFirstVisit: z.boolean(),
  maintenanceScheduleId: positiveId,
} satisfies Record<WorkOrderPatchField, z.ZodTypeAny>;

const schemaCache = new Map<string, z.ZodTypeAny>();

/** Schéma strict du rôle : une clé hors liste blanche est une erreur, pas un champ ignoré. */
export function workOrderPatchSchemaFor(role: string): z.ZodTypeAny | null {
  const fields = WORK_ORDER_PATCH_FIELDS_BY_ROLE[role];
  if (!fields) return null;
  let schema = schemaCache.get(role);
  if (!schema) {
    const shape = Object.fromEntries(fields.map((field) => [field, FIELD_SCHEMAS[field].optional()]));
    schema = z.object(shape).strict();
    schemaCache.set(role, schema);
  }
  return schema;
}

export const WORK_ORDER_NOT_ASSIGNED_ERROR = "Cet ordre de travail ne vous est pas assigné.";
export const WORK_ORDER_FIELDS_FORBIDDEN_ERROR = "Certaines informations de cet ordre de travail ne sont pas modifiables par votre rôle.";

const FORBIDDEN_FIELD_MESSAGES: Record<string, string> = {
  vehicleId: "Le véhicule d'un ordre de travail ne change pas : annulez-le et créez-en un autre.",
  technicianId: "L'affectation relève du chef d'atelier.",
  cost: "Le coût est calculé à partir des travaux et des pièces.",
};

export type WorkOrderPatchData = { [K in WorkOrderPatchField]?: any } & { updatedBy: number };

/**
 * Contrôle un corps de `PATCH /api/work-orders/:id` et renvoie ce qui peut être écrit, avec
 * `updatedBy` posé sur l'auteur. Lève `AppError` (400 type, 403 rôle ou affectation).
 */
export function validateWorkOrderPatch(input: {
  user: { id: number; role: string } | undefined;
  workOrder: Pick<WorkOrder, "vehicleId" | "technicianId">;
  body: unknown;
}): WorkOrderPatchData {
  const { user, workOrder, body } = input;
  if (!user) throw new AppError(401, "Authentification requise.");

  const schema = workOrderPatchSchemaFor(user.role);
  if (!schema) throw new AppError(403, WORK_ORDER_FIELDS_FORBIDDEN_ERROR, { cause: `rôle ${user.role}` });
  if (user.role === "technician" && workOrder.technicianId !== user.id) {
    throw new AppError(403, WORK_ORDER_NOT_ASSIGNED_ERROR);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(400, "Certaines informations de l'ordre de travail sont invalides.");
  }
  const candidate: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const copy of VEHICLE_COPIES) delete candidate[copy];
  // Le formulaire d'édition renvoie le véhicule courant : inchangé, il n'est pas une écriture.
  if ("vehicleId" in candidate && Number(candidate.vehicleId) === workOrder.vehicleId) delete candidate.vehicleId;

  const { data, errors } = prepareColumnUpdate(workOrders, candidate);
  if (errors.length > 0) {
    throw new AppError(400, "Certaines informations de l'ordre de travail sont invalides.", { fieldErrors: errors });
  }

  const allowed = new Set<string>(WORK_ORDER_PATCH_FIELDS_BY_ROLE[user.role]);
  const forbidden: ApiFieldError[] = Object.keys(data)
    .filter((field) => !allowed.has(field))
    .map((field) => ({ field, message: FORBIDDEN_FIELD_MESSAGES[field] ?? "Ce champ n'est pas modifiable." }));
  if (forbidden.length > 0) {
    throw new AppError(403, WORK_ORDER_FIELDS_FORBIDDEN_ERROR, {
      fieldErrors: forbidden,
      cause: `rôle ${user.role} : ${forbidden.map((f) => f.field).join(", ")}`,
    });
  }

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(400, "Certaines informations de l'ordre de travail sont invalides.", {
      fieldErrors: parsed.error.issues.map((issue) => ({
        field: String(issue.path[0] ?? ""),
        message: issue.message,
      })),
    });
  }
  return { ...(data as Record<string, unknown>), updatedBy: user.id } as WorkOrderPatchData;
}
