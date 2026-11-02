import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DOCUMENT_RENEWAL_VIEWER_ROLES, DOCUMENT_RENEWAL_WRITER_ROLES } from "@shared/constants/roles";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import {
  createDocumentRenewalCenterRequestSchema,
  documentRenewalCenterActivePath,
  documentRenewalCenterPath,
  setDocumentRenewalCenterActiveRequestSchema,
  updateDocumentRenewalCenterRequestSchema,
} from "@shared/contracts/document-renewal-centers";

const hook = readFileSync(path.resolve(__dirname, "../../../client/src/hooks/useRealTimeSync.ts"), "utf8");

describe("DOC1 : événement document_renewal_center_changed", () => {
  const def = REALTIME_EVENTS.document_renewal_center_changed;

  it("est déclaré en portée rôles, sans broadcast", () => {
    expect(def.scope).toMatchObject({ type: "roles" });
  });

  it("couvre les rôles écrivains et invalide la liste des choix", () => {
    const roles = (def.scope as { roles: readonly string[] }).roles;
    for (const role of DOCUMENT_RENEWAL_WRITER_ROLES) expect(roles).toContain(role);
    expect(roles).toEqual(DOCUMENT_RENEWAL_VIEWER_ROLES);
    expect(def.invalidates).toContain("/api/document-renewals/centers");
  });

  it("est traité côté client par un seul case qui invalide le catalogue", () => {
    expect(hook.match(/case "document_renewal_center_changed":/g)).toHaveLength(1);
    expect(hook).toContain('invalidateCatalogEvent("document_renewal_center_changed")');
  });
});

describe("DOC1 : contrat des centres", () => {
  it("normalise le texte (trim, vide en null) et accepte un type nul", () => {
    const parsed = createDocumentRenewalCenterRequestSchema.parse({ name: "  Centre A ", accreditationNumber: " ", documentType: null });
    expect(parsed).toMatchObject({ name: "Centre A", accreditationNumber: null, address: null, documentType: null });
  });

  it("refuse nom court, type inconnu et champs hors contrat", () => {
    expect(createDocumentRenewalCenterRequestSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(createDocumentRenewalCenterRequestSchema.safeParse({ name: "Centre", documentType: "permis" }).success).toBe(false);
    expect(createDocumentRenewalCenterRequestSchema.safeParse({ name: "Centre", isActive: false }).success).toBe(false);
  });

  it("la modification exige au moins un champ et ignore l'absent", () => {
    expect(updateDocumentRenewalCenterRequestSchema.safeParse({}).success).toBe(false);
    expect(updateDocumentRenewalCenterRequestSchema.parse({ address: "Douala" })).toEqual({ address: "Douala" });
  });

  it("l'activation attend un booléen strict", () => {
    expect(setDocumentRenewalCenterActiveRequestSchema.safeParse({ isActive: "false" }).success).toBe(false);
    expect(setDocumentRenewalCenterActiveRequestSchema.parse({ isActive: false })).toEqual({ isActive: false });
  });

  it("chemins exacts", () => {
    expect(documentRenewalCenterPath(7)).toBe("/api/document-renewals/centers/7");
    expect(documentRenewalCenterActivePath(7)).toBe("/api/document-renewals/centers/7/active");
  });
});
