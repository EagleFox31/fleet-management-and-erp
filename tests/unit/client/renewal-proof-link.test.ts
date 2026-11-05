import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(process.cwd(), "client/src/pages/vehicles/documents.tsx"), "utf8");

describe("lien de telechargement du justificatif de renouvellement", () => {
  it("vise la route du justificatif de la demande", () => {
    expect(src).toContain("`/api/document-renewals/requests/${request.id}/proof`");
  });

  it("n'est affiche qu'aux roles lecteurs et si la demande porte un justificatif", () => {
    expect(src).toContain("DOCUMENT_RENEWAL_VIEWER_ROLES");
    expect(src).toMatch(/canReadRenewals && req\.proofFileName/);
  });

  it("affiche l'erreur par userMessageOf, sans message technique", () => {
    expect(src).toMatch(/userMessageOf\(error, "Le justificatif/);
    expect(src).not.toMatch(/error\.message/);
  });
});
