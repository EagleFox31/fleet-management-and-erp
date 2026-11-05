import { getDriverCpcEligibility, type CpcIneligibleCode } from "@shared/constants/driver-cpc-eligibility";

/** Chauffeur tel que renvoyé par GET /api/drivers. */
export interface WizardDriver {
  cpcStatus?: string | null;
  /** Statut enregistré en base, celui que lit la garde serveur. */
  cpcStatusRecorded?: string | null;
  cpcTrainingDate?: string | null;
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

/** Préfixe de la raison de blocage CPC (le détail est rendu par `getCpcBlockGuidance`). */
export const CPC_BLOCK_PREFIX = "Chauffeur non éligible : ";

/** Rôles autorisés par POST /api/drivers/:id/update-cpc (isDriverManager). */
const CPC_EDITOR_ROLES = ["admin", "logistics", "secretary"];

export interface CpcBlockGuidance {
  title: string;
  /** Pourquoi le chauffeur est bloqué. */
  why: string;
  /** Quoi faire ensuite, adapté au rôle. */
  action: string;
  /** Vrai quand le rôle peut corriger la fiche chauffeur lui-même. */
  canEditDriver: boolean;
}

/**
 * Explication d'un blocage CPC à l'étape 3 : cause et marche à suivre. La règle
 * de blocage reste celle de `getDriverCpcEligibility` ; ceci n'en change que le retour.
 * `null` quand le chauffeur est éligible ou absent.
 */
export function getCpcBlockGuidance(
  driver: WizardDriver | null | undefined,
  role: string | null | undefined,
): CpcBlockGuidance | null {
  if (!driver) return null;
  const cpc = getDriverCpcEligibility({
    cpcStatus: driverCpcStatusOf(driver),
    cpcTrainingDate: driver.cpcTrainingDate,
  });
  if (cpc.eligible || !cpc.code) return null;
  const canEditDriver = !!role && CPC_EDITOR_ROLES.includes(role);
  const why: Record<CpcIneligibleCode, string> = {
    EXPIRED: "La formation CPC de ce chauffeur a expiré : il ne peut pas être affecté à une mission.",
    NOT_VALID: "Ce chauffeur n'est pas à jour de sa formation CPC (statut différent de FORMÉ) : il ne peut pas être affecté à une mission.",
    MISSING: "Le statut CPC de ce chauffeur n'est pas renseigné : il ne peut pas être affecté à une mission.",
    FUTURE_DATE: "La date de formation CPC de ce chauffeur est postérieure à aujourd'hui : elle doit être vérifiée avant toute affectation.",
  };
  const action = canEditDriver
    ? "Choisissez un autre chauffeur, ou, si la formation a bien eu lieu, renseignez sa date de formation CPC dans sa fiche chauffeur."
    : "Choisissez un autre chauffeur, ou demandez à la logistique ou au secrétariat de mettre à jour la date de formation CPC dans sa fiche.";
  return { title: "CPC non à jour", why: why[cpc.code], action, canEditDriver };
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
        const cpc = getDriverCpcEligibility({
          cpcStatus: driverCpcStatusOf(input.selectedDriver),
          cpcTrainingDate: input.selectedDriver?.cpcTrainingDate,
        });
        if (!cpc.eligible) return `${CPC_BLOCK_PREFIX}${cpc.reason}`;
      }
      return null;
    }
    default:
      return null;
  }
}
