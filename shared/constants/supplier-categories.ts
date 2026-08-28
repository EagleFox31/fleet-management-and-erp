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

export function isTireSupplierCategory(category: string | null | undefined): boolean {
  const normalized = (category ?? "").toLowerCase();
  return normalized.includes("pneu");
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

  if (role === "workshop_manager") {
    return (
      isPartsSupplierCategory(categoryLower) ||
      categoryLower.includes("carburant") ||
      isTireSupplierCategory(categoryLower)
    );
  }

  if (role === "logistics") {
    return !categoryLower.includes("télécom") && !categoryLower.includes("telecom");
  }

  if (role === "warehouse") {
    return isPartsSupplierCategory(categoryLower) || isTireSupplierCategory(categoryLower);
  }

  return false;
}
