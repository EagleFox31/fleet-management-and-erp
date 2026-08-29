import type { AppRole } from "./roles";

export type SupplierRatingField =
  | "qualityRating"
  | "reliabilityRating"
  | "priceCompetitiveness";

/**
 * Quatrieme copie de la liste des roles avant unification: elle ignorait
 * `management` et `driver`, donc ajouter un role au schema cassait la
 * compilation ici. Le `switch` de `getSupplierRatingFieldPermissions` a un
 * `default` qui refuse tout, donc un nouveau role n'obtient aucun droit de
 * notation tant qu'on ne l'a pas decide explicitement — le bon defaut.
 */
export type SupplierRatingRole = AppRole;

export const SUPPLIER_RATING_FIELDS: Array<{
  field: SupplierRatingField;
  label: string;
  roleHint: string;
  /** Rôles autorisés à modifier ce critère (libellé UI). */
  editorsLabel: string;
  description: string;
}> = [
  {
    field: "qualityRating",
    label: "Qualité produits/services",
    roleHint: "Atelier / magasin",
    editorsLabel: "Admin, chef d'atelier, magasinier",
    description:
      "Conformité des produits reçus, qualité perçue et adéquation au besoin métier.",
  },
  {
    field: "reliabilityRating",
    label: "Fiabilité délais",
    roleHint: "Logistique",
    editorsLabel: "Admin, logisticien",
    description:
      "Respect des délais annoncés, régularité des livraisons et suivi des commandes.",
  },
  {
    field: "priceCompetitiveness",
    label: "Compétitivité prix",
    roleHint: "Secrétariat / compta",
    editorsLabel: "Admin, secrétaire",
    description:
      "Rapport qualité/prix, cohérence des tarifs facturés et écarts par rapport au marché.",
  },
];

export function getSupplierRatingFieldPermissions(
  role: SupplierRatingRole,
): Record<SupplierRatingField, boolean> {
  switch (role) {
    case "admin":
      return {
        qualityRating: true,
        reliabilityRating: true,
        priceCompetitiveness: true,
      };
    case "workshop_manager":
    case "warehouse":
      return {
        qualityRating: true,
        reliabilityRating: false,
        priceCompetitiveness: false,
      };
    case "logistics":
      return {
        qualityRating: false,
        reliabilityRating: true,
        priceCompetitiveness: false,
      };
    case "secretary":
      return {
        qualityRating: false,
        reliabilityRating: false,
        priceCompetitiveness: true,
      };
    default:
      return {
        qualityRating: false,
        reliabilityRating: false,
        priceCompetitiveness: false,
      };
  }
}
