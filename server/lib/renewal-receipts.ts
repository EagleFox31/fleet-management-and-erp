import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { documentRenewalRequests } from "@shared/schema";
import { OPEN_DOCUMENT_RENEWAL_STATUSES } from "@shared/constants/document-renewal-statuses";
import { RENEWAL_DOCUMENT_BLOCKER_CODE, type VehicleEligibilityInput } from "@shared/constants/vehicle-eligibility";
import { AppError } from "./app-error";
import type { DbExecutor } from "./fuel-card-lock";

/**
 * Récépissés valables d'un véhicule, prêts pour `getMissionEligibility` (`receipts`).
 * Ne retient que les demandes ouvertes (une demande terminée a posé la nouvelle échéance) et,
 * par papier, la date la plus lointaine. Le calcul « encore valable aujourd'hui » reste dans
 * `getMissionEligibility`, seule règle d'éligibilité.
 * Dans une transaction, passer `tx` : la lecture voit alors le même instantané que le reste du contrôle.
 */
export async function loadOpenRenewalReceipts(
  vehicleId: number,
  executor: DbExecutor = db,
): Promise<NonNullable<VehicleEligibilityInput["receipts"]>> {
  const rows = await executor
    .select({
      documentType: documentRenewalRequests.documentType,
      validUntil: sql<string>`max(${documentRenewalRequests.receiptValidUntil})::text`,
    })
    .from(documentRenewalRequests)
    .where(
      and(
        eq(documentRenewalRequests.vehicleId, vehicleId),
        inArray(documentRenewalRequests.status, [...OPEN_DOCUMENT_RENEWAL_STATUSES]),
        isNotNull(documentRenewalRequests.receiptValidUntil),
      ),
    )
    .groupBy(documentRenewalRequests.documentType);

  const receipts: NonNullable<VehicleEligibilityInput["receipts"]> = {};
  for (const row of rows) {
    const code = row.documentType ? RENEWAL_DOCUMENT_BLOCKER_CODE[row.documentType] : undefined;
    if (code && row.validUntil) receipts[code] = row.validUntil;
  }
  return receipts;
}

/**
 * Violation du CHECK `document_renewal_requests_receipt_complete` (23514) : un récépissé à moitié
 * renseigné. Message lisible, jamais le texte SQL ; `null` pour toute autre erreur.
 */
export function renewalReceiptErrorOf(error: unknown): AppError | null {
  const code = (error as { code?: string; cause?: { code?: string } } | null)?.code
    ?? (error as { cause?: { code?: string } } | null)?.cause?.code;
  if (code !== "23514") return null;
  return new AppError(400, "Le récépissé est incomplet : fichier et date de validité sont obligatoires ensemble.", { cause: error });
}

/**
 * Copie d'une ligne de demande (ou de document) sans aucun chemin disque : `receiptFilePath`,
 * `proofFilePath`, `filePath`. Seule porte de sortie des lignes vers les réponses et les diffusions.
 */
export function withoutDiskPaths<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !/file_?path$/i.test(key)));
}
