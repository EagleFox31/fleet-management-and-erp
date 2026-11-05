import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_PROOF_PREFIX,
  isSettlementProofReference,
  settlementProofContentType,
  settlementProofFileName,
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

describe("justificatif de règlement : liens résolus", () => {
  it("un lien posé dans le dossier et qui mène dehors : refusé ; un fichier réel : conservé", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-proof-"));
    try {
      const dir = path.join(tmp, "uploads", "supplier-invoices", "settlements");
      const outside = path.join(tmp, "outside");
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(dir, "vrai.pdf"), "pdf");
      fs.symlinkSync(outside, path.join(dir, "piege.pdf"), "junction");
      expect(settlementProofPath(`${SETTLEMENT_PROOF_PREFIX}vrai.pdf`, tmp)).toBe(path.join(dir, "vrai.pdf"));
      expect(settlementProofPath(`${SETTLEMENT_PROOF_PREFIX}piege.pdf`, tmp)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("nom disque du justificatif téléversé : toujours accepté à la relecture", () => {
  it.each([
    ["nom simple", "facture.pdf", /^facture-U\.pdf$/],
    ["espace dans l'extension", "scan.p f", /^scan-U\.p_f$/],
    ["extension longue", "a.verylongextension", /^a-U\.verylonge$/],
    ["accents et espaces", "Reçu été 2026.PDF", /^Re_u__t__2026-U\.pdf$/],
    ["séparateurs", "../../x/y.pdf", /^\.\._\.\._x_y-U\.pdf$/],
    ["séparateur Windows", "..\\a.png", /^\.\._a-U\.png$/],
    ["espace final", "Facture.PDF ", /^Facture-U\.pdf_$/],
    ["copie numérotée", "scan.pdf(1)", /^scan-U\.pdf_1_$/],
    ["accent dans l'extension", "reçu.pdé", /^re_u-U\.pd_$/],
    ["sans extension", "justificatif", /^justificatif-U\.bin$/],
    ["point final", "a.", /^a-U\.bin$/],
    ["vide", "", /^proof-U\.bin$/],
    ["absent", undefined, /^proof-U\.bin$/],
    ["nom très long", `${"x".repeat(300)}.pdf`, /^x{40}-U\.pdf$/],
  ])("%s", (_label, original, expected) => {
    const name = settlementProofFileName(original as string | undefined, "U");
    expect(name).toMatch(expected);
    expect(isSettlementProofReference(`${SETTLEMENT_PROOF_PREFIX}${name}`)).toBe(true);
  });
});

describe("justificatif : extension tirée du type déclaré, type servi en liste blanche", () => {
  it.each([
    ["page.html", "application/pdf", /^page-U\.pdf$/],
    ["photo.svg", "image/png", /^photo-U\.png$/],
    ["scan.PDF", "image/jpeg", /^scan-U\.jpg$/],
    ["x.pdf", "text/html", /^x-U\.bin$/],
    ["x.pdf", "constructor", /^x-U\.bin$/],
  ])("%s déclaré %s", (original, mime, expected) => {
    const name = settlementProofFileName(original, "U", mime);
    expect(name).toMatch(expected);
    expect(isSettlementProofReference(`${SETTLEMENT_PROOF_PREFIX}${name}`)).toBe(true);
  });

  it.each([
    ["a.pdf", "application/pdf"],
    ["a.JPEG", "image/jpeg"],
    ["a.webp", "image/webp"],
    ["a.html", "application/octet-stream"],
    ["a.svg", "application/octet-stream"],
    ["a.bin", "application/octet-stream"],
    ["a", "application/octet-stream"],
  ])("%s servi en %s", (file, type) => {
    expect(settlementProofContentType(file)).toBe(type);
  });
});
