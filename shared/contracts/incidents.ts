/**
 * Déclaration de panne (P-22). Drapeau `incidents`.
 * Une déclaration prévient le chef d'atelier et l'admin (`incident_reported`).
 */
import { z } from "zod";
import { isoDateTimeSchema } from "./common";

export const INCIDENTS_PATH = "/api/incidents";

export const INCIDENT_SEVERITIES = ["low", "medium", "high"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = ["open", "in_progress", "resolved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const createIncidentRequestSchema = z.object({
  vehicleId: z.number().int().positive(),
  description: z.string().trim().min(5).max(2000),
  severity: z.enum(INCIDENT_SEVERITIES),
});

export const incidentsQuerySchema = z.object({ status: z.enum(INCIDENT_STATUSES).optional() });

export const incidentSchema = z.object({
  id: z.number().int(),
  vehicleId: z.number().int(),
  reportedBy: z.number().int().nullable(),
  reportedByName: z.string().nullable(),
  description: z.string(),
  severity: z.enum(INCIDENT_SEVERITIES),
  status: z.enum(INCIDENT_STATUSES),
  workOrderId: z.number().int().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const incidentsResponseSchema = z.array(incidentSchema);

export type CreateIncidentRequest = z.infer<typeof createIncidentRequestSchema>;
export type Incident = z.infer<typeof incidentSchema>;
