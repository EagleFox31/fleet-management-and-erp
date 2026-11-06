import { z } from "zod";
import { statusHistory } from "@shared/schema";

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

// Valeur vide du formulaire = « non renseigné ».
const emptyAsNull = (value: unknown) => (value === "" ? null : value);

/**
 * Date de maintenance au jour près : l'activation construit `${date}T00:00:00`, une date ISO complète
 * donnerait « Invalid Date » après la création du véhicule. Un horodatage ISO (brouillon restauré)
 * est ramené à son jour. Bornée pour refuser une saisie absurde.
 */
const maintenanceDay = z.preprocess(
  (value) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(0, 10) : emptyAsNull(value)),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ")
    .refine((value) => !Number.isNaN(Date.parse(value)), "Date invalide")
    .refine((value) => value >= "1990-01-01" && value <= "2100-12-31", "Date hors de la plage 1990-2100")
    .nullish(),
);

/** Kilométrage entier ; une chaîne numérique du formulaire est acceptée et convertie. */
const MAX_MILEAGE_KM = 10_000_000;
const maintenanceMileage = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : emptyAsNull(value)),
  z.number().int().nonnegative().max(MAX_MILEAGE_KM).nullish(),
);

export const activationWorkflowDataSchema = z
  .object({
    // Vide tant que le brouillon n'est pas enregistré : la route ne clôture alors aucun workflow.
    sessionId: z.string().max(200).nullish(),
    // Écrit tel quel dans status_history : seules les valeurs de son énumération passent.
    status: z.preprocess(emptyAsNull, z.enum(statusHistory.status.enumValues).nullish()),
    firstMaintenanceDate: maintenanceDay,
    nextMaintenanceDate: maintenanceDay,
    nextMaintenanceMileage: maintenanceMileage,
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
