/**
 * Éligibilité CPC d'un chauffeur à une mission.
 *
 * Source unique : le serveur refuse l'affectation avec cette règle, l'assistant
 * de création de mission l'applique à l'identique pour expliquer le blocage.
 *
 * La règle porte sur le statut CPC ENREGISTRÉ du chauffeur (`drivers.cpc_status`),
 * insensible à la casse et aux accents. Elle ne recalcule rien depuis la date de
 * formation : la liste `/api/drivers` recalcule son statut d'affichage depuis
 * `cpcTrainingDate`, ce qui donne « NON FORMÉ » à un chauffeur dont le statut
 * enregistré est valide mais dont la date est absente.
 */

export interface DriverCpcInput {
  /** Statut enregistré (colonne `cpc_status`). */
  cpcStatus?: string | null;
}

export interface DriverCpcEligibility {
  eligible: boolean;
  /** Raison lisible, absente quand le chauffeur est éligible. */
  reason?: string;
}

export function normalizeCpcStatus(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

export function isCpcStatusValid(value: string | null | undefined): boolean {
  return normalizeCpcStatus(value) === "FORME";
}

export function getDriverCpcEligibility(driver: DriverCpcInput): DriverCpcEligibility {
  if (isCpcStatusValid(driver.cpcStatus)) return { eligible: true };
  const status = (driver.cpcStatus || "").trim();
  return {
    eligible: false,
    reason: status
      ? `CPC non valide (statut : ${status}). Un chauffeur au statut FORMÉ est requis.`
      : "CPC non renseigné. Un chauffeur au statut FORMÉ est requis.",
  };
}
