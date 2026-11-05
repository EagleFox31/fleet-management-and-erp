/**
 * Journal d'audit (P-04), lecture admin.
 *
 * Écrit par l'intercepteur déclaratif `auditWrites(config)` après toute
 * écriture réussie, clés sensibles masquées. L'historique d'un ordre de
 * travail (P-13) en est une vue filtrée.
 */
import { z } from "zod";
import { dateRangeQuerySchema, idSchema, isoDateTimeSchema, pagedResponseSchema, pageQuerySchema } from "./common";

export const AUDIT_LOGS_PATH = "/api/audit-logs";

export const AUDIT_ACTIONS = ["create", "update", "delete", "lock", "unlock", "login"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Valeur qui remplace une clé sensible (`password`, `pin`, `token`, `*secret*`). */
export const AUDIT_MASK = "***";

export const auditLogsQuerySchema = dateRangeQuerySchema.and(
  pageQuerySchema.extend({
    userId: idSchema.optional(),
    entityType: z.string().trim().min(1).max(60).optional(),
    entityId: z.string().trim().min(1).max(60).optional(),
  }),
);

export const auditLogRowSchema = z.object({
  id: z.number().int(),
  at: isoDateTimeSchema,
  userId: z.number().int().nullable(),
  userName: z.string().nullable(),
  action: z.enum(AUDIT_ACTIONS),
  entityType: z.string(),
  entityId: z.string().nullable(),
  method: z.string().nullable(),
  path: z.string().nullable(),
  /** Corps de la requête, clés sensibles masquées. */
  details: z.record(z.unknown()).nullable(),
});

export const auditLogsResponseSchema = pagedResponseSchema(auditLogRowSchema);

export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;
export type AuditLogRow = z.infer<typeof auditLogRowSchema>;
export type AuditLogsResponse = z.infer<typeof auditLogsResponseSchema>;
