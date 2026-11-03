import { todayUtcDateOnly, utcDateOnly } from "../lib/utc-day";
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

import { daysBetweenDateOnly, toExpiryDateOnly } from "./expiry-day";

export type VehicleEligibilityStatus = "operational" | "maintenance" | "out_of_service";

export interface VehicleEligibilityInput {
  status: VehicleEligibilityStatus | string | null | undefined;
  /** Dates d'échéance. `null` = non renseignée, voir la règle ci-dessous. */
  insuranceExpiry?: string | Date | null;
  technicalInspectionDate?: string | Date | null;
  licensePlateExpiry?: string | Date | null;
  /**
   * Date de validité du récépissé provisoire d'une demande de renouvellement en cours, par
   * papier (`document_renewal_requests.receipt_valid_until`). Un papier échu reste éligible
   * jusqu'à cette date incluse, puis de nouveau bloqué : la date entre ici, pas dans une
   * règle locale de l'appelant. Voir `loadOpenRenewalReceipts` (server/lib/renewal-receipts.ts).
   */
  receipts?: Partial<Record<DocumentBlockerCode, string | Date | null>>;
}

export type DocumentBlockerCode = "insurance" | "technical_inspection" | "license_plate";

/** Type de papier d'une demande de renouvellement -> motif d'éligibilité qu'un récépissé lève. */
export const RENEWAL_DOCUMENT_BLOCKER_CODE: Readonly<Record<string, DocumentBlockerCode>> = {
  assurance: "insurance",
  visite_technique: "technical_inspection",
  carte_grise: "license_plate",
};

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
  // Date UTC sans heure, comme les statistiques et les alertes (expiry-day.ts) :
  // une échéance « aujourd'hui » vaut 0 jour (valable), quel que soit le fuseau de la machine.
  const dateEcheance = toExpiryDateOnly(echeance);
  if (dateEcheance === null) return null;
  return -daysBetweenDateOnly(dateEcheance, todayUtcDateOnly(aujourdhui));
}

/** Jour calendaire d'une valeur, en UTC : `AAAA-MM-JJ` lu tel quel, `Date` par son jour UTC. */
function jourCalendaire(valeur: string | Date): number | null {
  const iso = typeof valeur === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(valeur) : null;
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const date = valeur instanceof Date ? valeur : new Date(valeur);
  if (Number.isNaN(date.getTime())) return null;
  return jourCalendaire(utcDateOnly(date));
}

/** Récépissé encore valable : sa date de validité est aujourd'hui ou plus tard (jour J inclus). */
function recepisseValide(validite: string | Date | null | undefined, aujourdhui: Date): boolean {
  if (!validite) return false;
  const fin = jourCalendaire(validite);
  const jour = jourCalendaire(todayUtcDateOnly(aujourdhui));
  return fin !== null && jour !== null && fin >= jour;
}

/**
 * Un récépissé provisoire couvre-t-il ce papier aujourd'hui ? Pour les contrôles qui lisent
 * `vehicle_documents` plutôt que les colonnes miroir (lancement de mission) : même règle que
 * `getMissionEligibility`, jour J inclus. Le récépissé lève une échéance dépassée, jamais un
 * papier manquant.
 */
export function isRenewalReceiptValid(
  receipts: VehicleEligibilityInput["receipts"],
  code: DocumentBlockerCode,
  aujourdhui: Date = new Date(),
): boolean {
  return recepisseValide(receipts?.[code], aujourdhui);
}

function formuler(libelle: string, jours: number): string {
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
    if (jours === null || jours <= 0) continue;
    if (recepisseValide(vehicle.receipts?.[doc.code as DocumentBlockerCode], aujourdhui)) continue;
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
