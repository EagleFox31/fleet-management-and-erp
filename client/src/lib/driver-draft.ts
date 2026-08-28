import { createFormDraftStorage } from "@/lib/form-draft-storage";

/**
 * Brouillon du formulaire chauffeur.
 *
 * La fiche est longue (identité + CNI + permis + CPC) et souvent remplie en
 * plusieurs fois: la saisie ne doit pas disparaître sur un rafraîchissement.
 * Même mécanique que `supplier-new-draft` et `tire-wizard-draft`.
 */
export type DriverDraftData = {
  firstName: string;
  lastName: string;
  employeeNumber: string;
  licenseNumber: string;
  licenseExpiry: string;
  cniNumber: string;
  cniExpiry: string;
  cpcTrainingDate: string;
  isActive: "true" | "false";
};

export const driverDraftStorage = createFormDraftStorage<DriverDraftData>({
  formId: "driver-form",
  version: 1,
});

/**
 * Un formulaire vierge ne mérite pas d'être sauvegardé ni restauré: sans ça,
 * ouvrir puis fermer la modale laisserait un brouillon vide qui déclenche le
 * toast de restauration à la visite suivante.
 */
export function isDriverFormEmpty(data: DriverDraftData): boolean {
  return (
    !data.firstName.trim() &&
    !data.lastName.trim() &&
    !data.employeeNumber.trim() &&
    !data.licenseNumber.trim() &&
    !data.licenseExpiry.trim() &&
    !data.cniNumber.trim() &&
    !data.cniExpiry.trim() &&
    !data.cpcTrainingDate.trim()
  );
}
