import { getDriverCpcEligibility } from "@shared/constants/driver-cpc-eligibility";

/** Chauffeur tel que renvoyé par GET /api/drivers. */
export interface WizardDriver {
  cpcStatus?: string | null;
  /** Statut enregistré en base, celui que lit la garde serveur. */
  cpcStatusRecorded?: string | null;
}

export interface WizardStepInput {
  step: number;
  clientId: string;
  orderNumber: string;
  pickupAddress: string;
  deliveryAddress: string;
  vehicleId: string;
  driverId: string;
  weightCompatible: boolean;
  cargoWeight: string;
  vehicleTonnage: number | string | null | undefined;
  selectedDriver?: WizardDriver | null;
}

/**
 * Statut CPC à évaluer : l'enregistré quand l'API le fournit (c'est lui que la
 * garde d'affectation du serveur lit), sinon celui d'affichage.
 */
export function driverCpcStatusOf(driver: WizardDriver | null | undefined): string | null {
  if (!driver) return null;
  return "cpcStatusRecorded" in driver ? (driver.cpcStatusRecorded ?? null) : (driver.cpcStatus ?? null);
}

/** Raison pour laquelle « Suivant » est bloqué à cette étape, ou null. */
export function getStepBlockReason(input: WizardStepInput): string | null {
  switch (input.step) {
    case 1:
      if (!input.clientId) return "Choisissez un client pour continuer.";
      if (!input.orderNumber.trim()) return "Renseignez le numéro de commande ou de bon de livraison pour continuer.";
      return null;
    case 2:
      if (!input.pickupAddress.trim()) return "Renseignez l'adresse d'enlèvement pour continuer.";
      if (!input.deliveryAddress.trim()) return "Renseignez l'adresse de livraison pour continuer.";
      return null;
    case 3: {
      if (input.vehicleId && !input.weightCompatible) {
        return `Le poids du cargo (${input.cargoWeight} T) dépasse le tonnage du véhicule (${input.vehicleTonnage ?? "N/A"} T).`;
      }
      if (input.driverId) {
        const cpc = getDriverCpcEligibility({ cpcStatus: driverCpcStatusOf(input.selectedDriver) });
        if (!cpc.eligible) return `Chauffeur non éligible : ${cpc.reason}`;
      }
      return null;
    }
    default:
      return null;
  }
}
