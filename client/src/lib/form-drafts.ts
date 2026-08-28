import { createFormDraftStorage } from "@/lib/form-draft-storage";

/**
 * Registre des brouillons de formulaire.
 *
 * Les trois premiers formulaires équipés ont chacun leur module
 * (`supplier-new-draft`, `tire-wizard-draft`, `driver-draft`). Pour les
 * suivants, un registre unique: le `formId` doit être **unique dans toute
 * l'application** — deux formulaires partageant le même identifiant se
 * marcheraient dessus dans `localStorage`. Dispersés dans quatorze fichiers,
 * une collision est invisible; ici elle saute aux yeux.
 *
 * ⚠️ Aucun formulaire contenant un mot de passe ou un code PIN ne doit
 * apparaître ici: le brouillon écrirait le secret en clair dans le navigateur.
 * C'est pourquoi `user-form` et l'écran de connexion en sont absents.
 */

/** Un champ compte comme rempli s'il porte du texte ou un nombre non nul. */
function tousVides<T extends Record<string, unknown>>(data: T, champs: Array<keyof T>): boolean {
  return champs.every((champ) => {
    const valeur = data[champ];
    if (valeur === null || valeur === undefined) return true;
    if (typeof valeur === "string") return valeur.trim() === "";
    if (typeof valeur === "number") return !Number.isFinite(valeur) || valeur === 0;
    return false;
  });
}

/**
 * Fabrique un couple {storage, isEmpty} pour un formulaire.
 * `champsSignificatifs`: ceux qui prouvent que l'utilisateur a saisi quelque
 * chose. Ne jamais y mettre un champ pré-rempli par défaut (statut, unité,
 * date du jour), sinon le formulaire n'est jamais considéré comme vierge et on
 * sauvegarde des brouillons vides.
 */
function definirBrouillon<T extends Record<string, unknown>>(
  formId: string,
  champsSignificatifs: Array<keyof T>,
) {
  return {
    storage: createFormDraftStorage<T>({ formId, version: 1 }),
    isEmpty: (data: T) => tousVides(data, champsSignificatifs),
  };
}

// ── Parc et maintenance ──────────────────────────────────────────────────────

export const vehicleDraft = definirBrouillon<Record<string, unknown>>("vehicle-form", [
  "registrationNumber",
  "brand",
  "model",
  "vin",
  "engineSpec",
  "notes",
]);

export const workOrderDraft = definirBrouillon<Record<string, unknown>>("work-order-form", [
  "title",
  "description",
  "diagnosis",
]);

export const maintenanceScheduleDraft = definirBrouillon<Record<string, unknown>>(
  "maintenance-schedule-form",
  ["title", "description"],
);

export const preventiveDraft = definirBrouillon<Record<string, unknown>>("preventive-schedule", [
  "title",
  "description",
]);

// ── Stock ────────────────────────────────────────────────────────────────────

export const partDraft = definirBrouillon<Record<string, unknown>>("part-form", [
  "name",
  "reference",
  "description",
  "location",
]);

// Référentiel pièces: trois formulaires courts (2 à 3 champs). Équipés pour
// l'uniformité du comportement, mais le gain y est faible — si le badge
// « Brouillon » fait du bruit sur ces écrans, ce sont les premiers à retirer.
export const partCategoryDraft = definirBrouillon<Record<string, unknown>>("part-category", [
  "name",
  "description",
]);

export const partSpecificationDraft = definirBrouillon<Record<string, unknown>>(
  "part-specification",
  ["name", "description"],
);

export const partVariantDraft = definirBrouillon<Record<string, unknown>>("part-variant", [
  "variantName",
  "variantCode",
]);

export const partRequirementDraft = definirBrouillon<Record<string, unknown>>(
  "part-requirement-new",
  ["reason", "notes"],
);

export const tireRotationDraft = definirBrouillon<Record<string, unknown>>("tire-rotation", [
  "rotationMileage",
  "notes",
]);

// Inspection: relevés de terrain (usure, pression, défauts). C'est le plus long
// des deux et celui qui justifie vraiment le brouillon.
export const tireInspectionDraft = definirBrouillon<Record<string, unknown>>("tire-inspection", [
  "treadDepth",
  "pressure",
  "defectDescription",
  "recommendedAction",
  "notes",
]);

// ── Carburant ────────────────────────────────────────────────────────────────

export const fuelRecordDraft = definirBrouillon<Record<string, unknown>>("fuel-record-form", [
  "quantity",
  "cost",
  "mileage",
  "notes",
]);

// ── Achats ───────────────────────────────────────────────────────────────────

export const supplierInvoiceDraft = definirBrouillon<Record<string, unknown>>(
  "supplier-invoice-new",
  ["invoiceNumber", "notes"],
);

export const purchaseOrderDraft = definirBrouillon<Record<string, unknown>>("purchase-order-new", [
  "notes",
  "expectedDeliveryDate",
]);
