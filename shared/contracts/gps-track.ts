import { z } from "zod";
import { MAX_DB_INTEGER_ID } from "./common";

/**
 * Trace GPS d'une mission (GPS V1 téléphone, drapeau `gps`). Lecture côté client de ce que
 * renvoient `GET /api/missions/:id/track?since=&limit=` et
 * `POST /api/driver/missions/:id/positions`. Contrat de lecture : un champ ajouté par le serveur
 * est ignoré, jamais refusé.
 */
export const missionTrackPath = (missionId: number | string) => `/api/missions/${missionId}/track`;
export const driverMissionPositionsPath = (missionId: number | string) => `/api/driver/missions/${missionId}/positions`;

const geoPointSchema = z.object({
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  hubCode: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
});

export const missionTrackPointSchema = z.object({
  id: z.number().int().positive().max(MAX_DB_INTEGER_ID).optional(),
  recordedAt: z.string(),
  lat: z.number(),
  lng: z.number(),
  accuracyM: z.number().nullable().optional(),
  speedKmh: z.number().nullable().optional(),
  heading: z.number().nullable().optional(),
  suspect: z.boolean().optional(),
});

export const missionTrackResponseSchema = z.object({
  missionId: z.number().int().positive().max(MAX_DB_INTEGER_ID),
  status: z.string(),
  pickup: geoPointSchema,
  delivery: geoPointSchema,
  points: z.array(missionTrackPointSchema),
  truncated: z.boolean(),
});

export const driverPositionsResponseSchema = z.object({
  accepted: z.number().int().min(0),
  duplicates: z.number().int().min(0),
  rejected: z.number().int().min(0),
});

export type MissionTrackResponse = z.infer<typeof missionTrackResponseSchema>;
export type MissionTrackPoint = z.infer<typeof missionTrackPointSchema>;
