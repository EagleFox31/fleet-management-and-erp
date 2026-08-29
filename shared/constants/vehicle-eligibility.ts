/**
 * Éligibilité d'un véhicule à partir en mission.
 *
 * Deux questions distinctes, que le modèle confondait jusqu'ici :
 *
 * | Question | Portée par |
 * |---|---|
 * | Le camion **peut**-il rouler ? | `vehicles.status` (état mécanique) |
 * | Le camion **a-t-il le droit** de rouler ? | assurance, visite technique, plaque |
 *
 * Une assurance expirée n'immobilise pas mécaniquement : le camion est bon, il
 * est seulement interdit de route. Il reste donc `operational` — et devient
 * inéligible. Ne pas le passer en `maintenance`, ce serait mentir sur son état
 * et le faire compter dans les immobilisations d'atelier.
 *
 * Source unique : le serveur refuse l'affectation avec ces règles, l'interface
 * grise les mêmes véhicules avec les mêmes raisons.
 */

export type VehicleEligibilityStatus = "operational" | "maintenance" | "out_of_service";

export interface VehicleEligibilityInput {
  status: VehicleEligibilityStatus | string | null | undefined;
  /** Dates d'échéance. `null` = non renseignée, voir la règle ci-dessous. */
  insuranceExpiry?: string | Date | null;
  technicalInspectionDate?: string | Date | null;
  licensePlateExpiry?: string | Date | null;
}

export type EligibilityBlockerCode =
  | "maintenance"
  | "out_of_service"
  | "insurance"
  | "technical_inspection"
  | "license_plate";

export interface EligibilityBlocker {
  code: EligibilityBlockerCode;
  /** Nature du refus: l'état mécanique et la conformité ne se traitent pas pareil. */
  kind: "mechanical" | "compliance";
  /** Phrase prête à afficher, sans l'immatriculation — l'appelant la préfixe. */
  reason: string;
}

/** Jours écoulés depuis une échéance. Positif = dépassée. */
function joursDepuis(echeance: string | Date, aujourdhui: Date): number | null {
  const date = echeance instanceof Date ? echeance : new Date(echeance);
  if (Number.isNaN(date.getTime())) return null;
  // Comparaison de minuit à minuit: une échéance « aujourd'hui » vaut 0 jour,
  // pas quelques heures selon l'instant du calcul.
  const a = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const b = Date.UTC(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate());
  return Math.round((b - a) / 86_400_000);
}

function formuler(libelle: string, jours: number): string {
  if (jours === 0) return `${libelle} expire aujourd'hui`;
  if (jours === 1) return `${libelle} expirée depuis 1 jour`;
  return `${libelle} expirée depuis ${jours} jours`;
}

const DOCUMENTS: Array<{
  champ: keyof VehicleEligibilityInput;
  code: EligibilityBlockerCode;
  libelle: string;
}> = [
  { champ: "insuranceExpiry", code: "insurance", libelle: "assurance" },
  { champ: "technicalInspectionDate", code: "technical_inspection", libelle: "visite technique" },
  { champ: "licensePlateExpiry", code: "license_plate", libelle: "plaque" },
];

/**
 * Renvoie tous les motifs de refus, pas seulement le premier : un camion à
 * l'atelier ET sans assurance pose deux problèmes, et les régler l'un après
 * l'autre ferait perdre un aller-retour au logisticien.
 *
 * **Une date non renseignée ne bloque pas.** On ne sait pas, donc on n'affirme
 * pas — bloquer sur l'absence immobiliserait toute la flotte tant que le
 * référentiel n'est pas complet, et la règle finirait désactivée. L'absence
 * relève de l'alerte documentaire, pas du refus d'affectation.
 */
export function getMissionEligibility(
  vehicle: VehicleEligibilityInput,
  aujourdhui: Date = new Date(),
): { eligible: boolean; blockers: EligibilityBlocker[] } {
  const blockers: EligibilityBlocker[] = [];

  if (vehicle.status === "maintenance") {
    blockers.push({
      code: "maintenance",
      kind: "mechanical",
      reason: "véhicule à l'atelier (en maintenance)",
    });
  } else if (vehicle.status === "out_of_service") {
    blockers.push({
      code: "out_of_service",
      kind: "mechanical",
      reason: "véhicule hors service",
    });
  }

  for (const doc of DOCUMENTS) {
    const valeur = vehicle[doc.champ] as string | Date | null | undefined;
    if (!valeur) continue;
    const jours = joursDepuis(valeur, aujourdhui);
    if (jours === null || jours < 0) continue;
    blockers.push({
      code: doc.code,
      kind: "compliance",
      reason: formuler(doc.libelle, jours),
    });
  }

  return { eligible: blockers.length === 0, blockers };
}

/** Message d'affectation refusée, immatriculation comprise. */
export function formatEligibilityRefusal(
  registrationNumber: string,
  blockers: EligibilityBlocker[],
): string {
  return `${registrationNumber} ne peut pas partir en mission : ${blockers
    .map((b) => b.reason)
    .join(" ; ")}.`;
}
