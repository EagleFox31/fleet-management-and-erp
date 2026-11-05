import { describe, expect, it } from "vitest";
import {
  createQhseCriterionRequestSchema,
  createQhseInspectionRequestSchema,
  qhseCriteriaQuerySchema,
  qhseInspectionsQuerySchema,
  updateQhseCriterionRequestSchema,
} from "../../../shared/contracts/qhse-inspections";
import { MAX_DB_INTEGER_ID } from "../../../shared/contracts/common";
import { QHSE_CRITERIA_MANAGER_ROLES, QHSE_INSPECTION_ROLES } from "../../../shared/constants/roles";

const valid = {
  kind: "cabin",
  location: "Aire de Douala",
  vehicleId: 3,
  driverId: 4,
  items: [{ criterionId: 1, conform: false, observation: "Ceinture non portée" }],
};

describe("contrôles inopinés QHSE : validation des corps", () => {
  it("accepte une fiche complète et rogne les textes", () => {
    const parsed = createQhseInspectionRequestSchema.parse({ ...valid, location: "  Aire de Douala  " });
    expect(parsed.location).toBe("Aire de Douala");
  });

  it("refuse une fiche sans critère, sans lieu ou de nature inconnue", () => {
    expect(createQhseInspectionRequestSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
    expect(createQhseInspectionRequestSchema.safeParse({ ...valid, location: " " }).success).toBe(false);
    expect(createQhseInspectionRequestSchema.safeParse({ ...valid, kind: "road" }).success).toBe(false);
  });

  it("borne les identifiants à la plage d'un integer Postgres", () => {
    for (const bad of [0, -1, 1.5, MAX_DB_INTEGER_ID + 1]) {
      expect(createQhseInspectionRequestSchema.safeParse({ ...valid, vehicleId: bad }).success).toBe(false);
      expect(createQhseInspectionRequestSchema.safeParse({ ...valid, items: [{ criterionId: bad, conform: true }] }).success).toBe(false);
    }
    expect(qhseInspectionsQuerySchema.safeParse({ driverId: String(MAX_DB_INTEGER_ID + 1) }).success).toBe(false);
  });

  it("n'accepte pas de conformité en texte ni les champs d'audit du client", () => {
    expect(createQhseInspectionRequestSchema.safeParse({ ...valid, items: [{ criterionId: 1, conform: "oui" }] }).success).toBe(false);
    const parsed = createQhseInspectionRequestSchema.parse({ ...valid, inspectorId: 99, createdBy: 99 });
    expect(parsed).not.toHaveProperty("inspectorId");
    expect(parsed).not.toHaveProperty("createdBy");
  });

  it("critère : code en minuscules, nature cabin ou stop, modification non vide", () => {
    expect(createQhseCriterionRequestSchema.safeParse({ code: "epi", label: "Port des EPI", category: "cabin" }).success).toBe(true);
    expect(createQhseCriterionRequestSchema.safeParse({ code: "EPI !", label: "Port des EPI", category: "cabin" }).success).toBe(false);
    expect(createQhseCriterionRequestSchema.safeParse({ code: "epi", label: "Port des EPI", category: "road" }).success).toBe(false);
    expect(updateQhseCriterionRequestSchema.safeParse({}).success).toBe(false);
    expect(updateQhseCriterionRequestSchema.safeParse({ active: false }).success).toBe(true);
  });

  it("requêtes de liste : filtre actif lu en booléen, dates calendaires", () => {
    expect(qhseCriteriaQuerySchema.parse({ active: "false" }).active).toBe(false);
    expect(qhseCriteriaQuerySchema.safeParse({ active: "peut-etre" }).success).toBe(false);
    expect(qhseInspectionsQuerySchema.safeParse({ from: "2026-02-30" }).success).toBe(false);
    expect(qhseInspectionsQuerySchema.parse({}).page).toBe(1);
  });

  it("groupes de rôles : la direction et la logistique saisissent, le chauffeur n'y est pas", () => {
    expect([...QHSE_INSPECTION_ROLES]).toEqual(["admin", "management", "logistics"]);
    expect([...QHSE_INSPECTION_ROLES]).not.toContain("driver");
    expect([...QHSE_CRITERIA_MANAGER_ROLES]).toEqual(["admin", "management"]);
  });
});
