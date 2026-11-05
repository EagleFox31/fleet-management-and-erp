import path from "path";
import { isInsideDirectory } from "./uploaded-file";

/**
 * Justificatif de règlement fournisseur : la seule forme acceptée est celle
 * qu'écrit le téléversement (`POST /api/supplier-invoices/:id/settlements`),
 * un nom de fichier unique sous ce préfixe.
 */
export const SETTLEMENT_PROOF_PREFIX = "/uploads/supplier-invoices/settlements/";

const SETTLEMENT_PROOF_DIR_PARTS = ["uploads", "supplier-invoices", "settlements"] as const;

/** Nom de fichier seul, sans séparateur ; `.` et `..` exclus. */
function isProofFileName(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,128}$/.test(name) && name !== "." && name !== "..";
}

export function isSettlementProofReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(SETTLEMENT_PROOF_PREFIX) &&
    isProofFileName(value.slice(SETTLEMENT_PROOF_PREFIX.length))
  );
}

/**
 * Chemin disque du justificatif, ou `null` si la valeur stockée n'est pas un
 * justificatif téléversé. Couvre aussi les lignes écrites avant la validation.
 */
export function settlementProofPath(storedReference: string | null | undefined, root = process.cwd()): string | null {
  if (!isSettlementProofReference(storedReference)) return null;
  const directory = path.resolve(root, ...SETTLEMENT_PROOF_DIR_PARTS);
  const candidate = path.resolve(directory, storedReference.slice(SETTLEMENT_PROOF_PREFIX.length));
  return isInsideDirectory(directory, candidate) ? candidate : null;
}
