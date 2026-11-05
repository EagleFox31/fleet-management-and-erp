import { z } from "zod";
import { MAX_DB_INTEGER_ID } from "./common";

/**
 * Corps des écritures du parcours d'acquisition d'un véhicule (brouillon serveur et documents).
 * Validés par `validateBody` sur les routes de `/api/workflows`.
 *
 * Liste blanche des champs : le statut, le propriétaire et les dates ne viennent jamais du corps
 * (un `status: "completed"` à l'étape 5 déclenchait l'activation automatique du véhicule).
 * `workflowData` est le brouillon libre de l'écran (immatriculation, `purchasePrice`, etc.) :
 * champ optionnel ajouté dedans = aucun changement de contrat.
 */
const workflowFields = {
  currentStep: z.number({ invalid_type_error: "L'étape doit être un nombre." }).int().min(1, "Étape invalide.").max(5, "Étape invalide."),
  workflowData: z.record(z.unknown(), { invalid_type_error: "Les données du brouillon sont invalides." }),
  uploadedFiles: z.unknown().optional(),
};

export const workflowCreateRequestSchema = z.object({
  sessionId: z.string({ required_error: "L'identifiant de session est requis." }).trim().min(1, "L'identifiant de session est requis.").max(200),
  ...workflowFields,
});

export const workflowPatchRequestSchema = z.object(workflowFields).partial();

/** Champs texte du formulaire multipart de `POST /api/workflows/:sessionId/documents` (le fichier est `document`). */
export const workflowDocumentUploadRequestSchema = z.object({
  documentType: z.string({ required_error: "Le type de document est requis." }).trim().min(1, "Le type de document est requis."),
  workflowId: z.coerce
    .number({ invalid_type_error: "L'identifiant de workflow est invalide." })
    .int("L'identifiant de workflow est invalide.")
    .positive("L'identifiant de workflow est invalide.")
    .max(MAX_DB_INTEGER_ID, "L'identifiant de workflow est invalide."),
});
