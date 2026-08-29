import { describe, expect, it } from "vitest";
import {
  isTireSupplierCategory,
  isTireSupplierInvoiceFamily,
  TIRE_SUPPLIER_CATEGORIES,
  TIRE_SUPPLIER_CATEGORY_ILIKE_PATTERN,
  TIRE_SUPPLIER_CATEGORY_NEEDLE,
} from "@shared/constants/supplier-categories";

describe("isTireSupplierCategory", () => {
  it("reconnaît les catégories référentiel pneus", () => {
    expect(TIRE_SUPPLIER_CATEGORIES).toEqual(["Pneus"]);
    expect(isTireSupplierCategory("Pneus")).toBe(true);
    expect(isTireSupplierCategory("pneu")).toBe(true);
    expect(isTireSupplierCategory("Pneumatique PL")).toBe(true);
  });

  it("ignore les autres catégories fournisseur", () => {
    expect(isTireSupplierCategory("Pièces")).toBe(false);
    expect(isTireSupplierCategory("Carburant")).toBe(false);
    expect(isTireSupplierCategory("Assurance")).toBe(false);
  });

  it("expose un pattern ILIKE cohérent avec la règle métier", () => {
    expect(TIRE_SUPPLIER_CATEGORY_NEEDLE).toBe("pneu");
    expect(TIRE_SUPPLIER_CATEGORY_ILIKE_PATTERN).toBe("%pneu%");
  });
});

describe("isTireSupplierInvoiceFamily", () => {
  it("réutilise la même règle que la catégorie (family copiée à la réception)", () => {
    expect(isTireSupplierInvoiceFamily("Pneus")).toBe(true);
    expect(isTireSupplierInvoiceFamily("Pièces détachées")).toBe(false);
  });
});
