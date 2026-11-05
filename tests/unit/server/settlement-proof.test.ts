import path from "path";
import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_PROOF_PREFIX,
  isSettlementProofReference,
  settlementProofPath,
} from "../../../server/lib/settlement-proof";

const root = path.resolve("/srv/app");
const proofDir = path.join(root, "uploads", "supplier-invoices", "settlements");

describe("justificatif de règlement fournisseur : borné à son dossier", () => {
  it("accepte le nom écrit par le téléversement", () => {
    const ref = `${SETTLEMENT_PROOF_PREFIX}facture_A.12-1730700000000-123456789.pdf`;
    expect(isSettlementProofReference(ref)).toBe(true);
    expect(settlementProofPath(ref, root)).toBe(path.join(proofDir, "facture_A.12-1730700000000-123456789.pdf"));
  });

  it.each([
    ["vide", ""],
    ["référence libre", "VIR-2026-001"],
    ["autre dossier de uploads/", "/uploads/documents/carte-grise.pdf"],
    ["sans barre initiale", "uploads/supplier-invoices/settlements/a.pdf"],
    ["remontée", `${SETTLEMENT_PROOF_PREFIX}../../documents/a.pdf`],
    ["sous-dossier", `${SETTLEMENT_PROOF_PREFIX}x/a.pdf`],
    ["séparateur Windows", `${SETTLEMENT_PROOF_PREFIX}..\\a.pdf`],
    ["point seul", `${SETTLEMENT_PROOF_PREFIX}.`],
    ["deux points", `${SETTLEMENT_PROOF_PREFIX}..`],
    ["nom vide", SETTLEMENT_PROOF_PREFIX],
    ["espace", `${SETTLEMENT_PROOF_PREFIX}a b.pdf`],
    ["nom trop long", `${SETTLEMENT_PROOF_PREFIX}${"a".repeat(129)}`],
  ])("refuse : %s", (_label, ref) => {
    expect(isSettlementProofReference(ref)).toBe(false);
    expect(settlementProofPath(ref, root)).toBeNull();
  });

  it("refuse une valeur absente ou non textuelle", () => {
    expect(isSettlementProofReference(null)).toBe(false);
    expect(isSettlementProofReference(42)).toBe(false);
    expect(settlementProofPath(null, root)).toBeNull();
    expect(settlementProofPath(undefined, root)).toBeNull();
  });
});
