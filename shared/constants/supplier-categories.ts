/** Catégories métier des fournisseurs (référentiel UI + filtres). */
export const SUPPLIER_CATEGORIES = [
  "Assurance",
  "Pièces",
  "Pneus",
  "Télécom",
  "Carburant",
  "Autre",
] as const;

export type SupplierCategory = (typeof SUPPLIER_CATEGORIES)[number];

/** Sous-chaîne de reconnaissance — attrape « Pneus », « pneu », « Pneumatique », etc. */
export const TIRE_SUPPLIER_CATEGORY_NEEDLE = "pneu" as const;

/** Pattern ILIKE aligné sur `isTireSupplierCategory` (serveur SQL, filtres Direction). */
export const TIRE_SUPPLIER_CATEGORY_ILIKE_PATTERN = `%${TIRE_SUPPLIER_CATEGORY_NEEDLE}%` as const;

/** Sous-chaîne assurance — attrape « Assurance », « assurance flotte », etc. */
export const INSURANCE_SUPPLIER_CATEGORY_NEEDLE = "assurance" as const;

/** Pattern ILIKE pour assurances fournisseurs (TCO flotte, pas par véhicule). */
export const INSURANCE_SUPPLIER_CATEGORY_ILIKE_PATTERN = `%${INSURANCE_SUPPLIER_CATEGORY_NEEDLE}%` as const;

/** Catégories référentiel explicitement pneus (source unique pour inArray). */
export const TIRE_SUPPLIER_CATEGORIES = SUPPLIER_CATEGORIES.filter((category) =>
  isTireSupplierCategory(category),
);

export function isTireSupplierCategory(category: string | null | undefined): boolean {
  const normalized = (category ?? "").toLowerCase();
  return normalized.includes(TIRE_SUPPLIER_CATEGORY_NEEDLE);
}

/**
 * `supplier_invoices.family` reprend souvent la catégorie fournisseur à la réception
 * (cf. procurement-service : `family: supplierCategory || "Approvisionnement"`).
 * Saisie semi-structurée — même règle que la catégorie fournisseur.
 */
export function isTireSupplierInvoiceFamily(family: string | null | undefined): boolean {
  return isTireSupplierCategory(family);
}

export function isPartsSupplierCategory(category: string | null | undefined): boolean {
  const normalized = (category ?? "").toLowerCase();
  return normalized.includes("pièce") || normalized.includes("piece");
}

export function canRoleEvaluateSupplierCategory(role: string, category: string | null | undefined): boolean {
  const categoryLower = (category ?? "").toLowerCase();

  if (role === "admin" || role === "secretary") {
    return true;
  }

  // Le chef d'atelier consulte les fournisseurs, il ne les évalue pas (décision
  // produit du 1er novembre 2026) : il tombe dans le refus par défaut.

  if (role === "logistics") {
    return !categoryLower.includes("télécom") && !categoryLower.includes("telecom");
  }

  if (role === "warehouse") {
    return isPartsSupplierCategory(categoryLower) || isTireSupplierCategory(categoryLower);
  }

  return false;
}
