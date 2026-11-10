/**
 * Suivi GPS V1 (téléphone du chauffeur), lecture côté logisticien.
 *
 * Forme des réponses de `server/services/vehicle-positions-service.ts` (`LastPositionRow`,
 * `MissionTrack`). Contrat figé : ajout de champs facultatifs seulement. Rôles :
 * `GPS_VIEW_ROLES` (dernière position), `GPS_TRACK_ROLES` (trace), `MISSION_GEO_WRITE_ROLES`
 * (écriture des points A/B). Tout est derrière le drapeau `gps`.
 */
import { z } from "zod";
import { bodyIdSchema } from "./common";

/** Dernière position connue de chaque véhicule (points suspects exclus par le serveur). */
export const VEHICLE_POSITIONS_PATH = "/api/vehicle-positions";

/** Trace d'une mission : `/api/missions/<id>/track`. */
export const missionTrackPath = (missionId: number): string => `/api/missions/${missionId}/track`;

/** Points A/B d'une mission : `PATCH /api/missions/<id>/geo`. */
export const missionGeoPath = (missionId: number): string => `/api/missions/${missionId}/geo`;

export const vehiclePositionSchema = z.object({
  vehicleId: bodyIdSchema,
  registrationNumber: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  missionId: bodyIdSchema.nullable(),
  orderNumber: z.string().nullable().optional(),
  missionStatus: z.string().nullable().optional(),
  source: z.string(),
  lat: z.number(),
  lng: z.number(),
  accuracyM: z.number().nullable().optional(),
  speedKmh: z.number().nullable().optional(),
  heading: z.number().nullable().optional(),
  recordedAt: z.string(),
  ageSeconds: z.number().min(0),
});
export type VehiclePosition = z.infer<typeof vehiclePositionSchema>;
export const vehiclePositionsResponseSchema = z.array(vehiclePositionSchema);

const trackEndSchema = z.object({
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  hubCode: z.string().nullable(),
  address: z.string().nullable().optional(),
});
export type MissionTrackEnd = z.infer<typeof trackEndSchema>;

export const missionTrackPointSchema = z.object({
  // bigserial côté base : un int4 serait faux à terme, on borne à la limite des entiers exacts de JavaScript.
  // Exception documentée dans tests/unit/server/zod-id-range-hygiene.test.ts (BIGSERIAL_RESPONSE_IDS).
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  recordedAt: z.string(),
  lat: z.number(),
  lng: z.number(),
  accuracyM: z.number().nullable().optional(),
  speedKmh: z.number().nullable().optional(),
  heading: z.number().nullable().optional(),
  /** Véhicule émetteur : une mission à plusieurs affectations donne une polyligne par véhicule. */
  vehicleId: bodyIdSchema.nullable().optional(),
  /** Vitesse ou saut jugé impossible : tracé à part, jamais dans la dernière position. */
  suspect: z.boolean(),
});
export type MissionTrackPoint = z.infer<typeof missionTrackPointSchema>;

export const missionTrackResponseSchema = z.object({
  missionId: bodyIdSchema,
  status: z.string(),
  pickup: trackEndSchema,
  delivery: trackEndSchema,
  points: z.array(missionTrackPointSchema),
  truncated: z.boolean(),
});
export type MissionTrackResponse = z.infer<typeof missionTrackResponseSchema>;

/** Un point A ou B : hub du référentiel (clé minuscule), point posé sur la carte, ou rien. */
export type MissionGeoPointInput = { hubCode: string } | { lat: number; lng: number } | null;
