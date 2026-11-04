import { z } from "zod";

/**
 * Corps de POST /api/maintenance-schedules. Aucun champ serveur (`id`, `createdAt`, ...) : la base
 * les pose, `validateBody` retire ceux que le client enverrait.
 */
export const createMaintenanceScheduleRequestSchema = z.object({
  vehicleId: z.number().int().positive(),
  title: z.string().min(1, "Le titre est requis."),
  description: z.string().optional(),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly", "mileage"]),
  frequencyValue: z.number().min(1),
  scheduledDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, "Date invalide (AAAA-MM-JJ)")
    .refine((value) => !Number.isNaN(Date.parse(value)), "Date invalide (AAAA-MM-JJ)"),
  scheduledMileage: z.number().optional(),
  isActive: z.boolean().default(true),
});

/** Corps de POST /api/test-date-maintenance (déclenchement manuel d'une alerte à date). */
export const dateMaintenanceTriggerRequestSchema = z.object({
  vehicleId: z.number().int().positive(),
  alertType: z.enum(["maintenance", "insurance", "inspection", "license"]),
});

export type CreateMaintenanceScheduleRequest = z.infer<typeof createMaintenanceScheduleRequestSchema>;
export type DateMaintenanceTriggerRequest = z.infer<typeof dateMaintenanceTriggerRequestSchema>;
