import { z } from "zod";

/**
 * Corps `workflowData` de POST /api/vehicles/activate-from-workflow, vérifié AVANT la création
 * du véhicule : une donnée qui ferait échouer l'écriture des documents après coup (taille non
 * numérique, date illisible, document sans fichier) répond 400 au lieu de laisser un véhicule
 * orphelin derrière une 500.
 *
 * Le client envoie tout l'état du workflow (`...data`) : seules les clés lues par l'activation
 * sont contrôlées, les autres passent telles quelles (`passthrough`).
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, "Date attendue au format AAAA-MM-JJ")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Date invalide");

// Une date vide du formulaire vaut « pas de date ».
const optionalDate = z.preprocess((value) => (value === "" ? null : value), isoDate.nullish());
const size = z.number().int().nonnegative();
const text = z.string().max(500);

/** Document d'une liste (`workflowData.documents: [...]`), écrit tel quel dans vehicle_documents. */
const listedDocument = z
  .object({
    name: text.min(1),
    type: z.string().min(1).max(100),
    filename: text.min(1),
    filesize: size.default(0),
    file_type: z.string().min(1).max(200).default("application/octet-stream"),
    file_path: text.min(1),
    description: z.string().max(2000).nullish(),
    expiry_date: optionalDate,
  })
  .passthrough();

/**
 * Document rangé sous sa clé (`documents.carteGrise`, ou `carteGrise` à la racine). Tous les champs
 * sont facultatifs : un `File` du navigateur sérialisé en JSON arrive vide (`{}`) et sera ignoré.
 */
const keyedDocument = z
  .object({
    name: text.nullish(),
    filename: text.nullish(),
    originalName: text.nullish(),
    file_path: text.nullish(),
    filePath: text.nullish(),
    filesize: size.nullish(),
    size: size.nullish(),
    file_type: z.string().max(200).nullish(),
    type: z.string().max(200).nullish(),
    description: z.string().max(2000).nullish(),
    expiry_date: optionalDate,
  })
  .passthrough();

const keyedDocuments = z
  .object({
    carteGrise: keyedDocument.nullish(),
    assurance: keyedDocument.nullish(),
    visiteTechnique: keyedDocument.nullish(),
    facturAchat: keyedDocument.nullish(),
  })
  .passthrough();

export const activationWorkflowDataSchema = z
  .object({
    // Vide tant que le brouillon n'est pas enregistré : la route ne clôture alors aucun workflow.
    sessionId: z.string().max(200).nullish(),
    documents: z.union([z.array(listedDocument).max(50), keyedDocuments]).nullish(),
    // Lues à la racine par DocumentManagementService.extractDocumentsFromWorkflowData.
    carteGrise: keyedDocument.nullish(),
    assurance: keyedDocument.nullish(),
    visiteTechnique: keyedDocument.nullish(),
    taxe: keyedDocument.nullish(),
    autre: keyedDocument.nullish(),
  })
  .passthrough();

export type ActivationWorkflowData = z.infer<typeof activationWorkflowDataSchema>;
