import { z } from "zod";
import { MAX_DB_INTEGER_ID } from "./common";

const dbId = z.number().int().positive().max(MAX_DB_INTEGER_ID);

/** Preuve de livraison (POD) d'une mission : dépôt, liste et téléchargement. Jamais de chemin disque ni d'empreinte. */
export const missionPodFilesPath = (missionId: number | string) => `/api/missions/${missionId}/pod-files`;
export const missionPodFilePath = (missionId: number | string, fileId: number | string) => `${missionPodFilesPath(missionId)}/${fileId}`;

export const missionPodFileSchema = z
  .object({
    id: dbId,
    originalName: z.string().nullable(),
    mime: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
    sizeBytes: z.number().int().positive(),
    uploadedAt: z.string(),
    uploadedByName: z.string().nullable().optional(),
  })
  .strict();

/** POST : 201 même si tout est doublon. `duplicates` compte les contenus déjà enregistrés, `fileCount` les fichiers de la mission. */
export const missionPodUploadResponseSchema = z
  .object({
    files: z.array(missionPodFileSchema),
    duplicates: z.number().int().min(0),
    fileCount: z.number().int().min(1),
  })
  .strict();
export type MissionPodUploadResponse = z.infer<typeof missionPodUploadResponseSchema>;

export const missionPodListResponseSchema = z.object({ files: z.array(missionPodFileSchema) }).strict();
