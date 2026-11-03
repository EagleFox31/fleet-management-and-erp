import {
  daysBetweenDateOnly,
  isDriverLicenseExpiredOn,
  toExpiryDateOnly,
  todayUtcDateOnly,
} from "@shared/constants/expiry-day";

/**
 * Statut d'affichage du permis chauffeur. Même règle que le serveur (check-list et
 * lancement de mission) : `isDriverLicenseExpiredOn`, jour UTC, valable le jour J,
 * expiré à J+1 (#224). Aucun calcul de date local ici.
 */
export type DriverLicenseState = "none" | "expired" | "soon" | "warning" | "valid";

export interface DriverLicenseStatus {
  state: DriverLicenseState;
  /** Jours restants (0 = dernier jour de validité), `null` si absent ou illisible. */
  days: number | null;
}

export function getDriverLicenseStatus(
  expiry: string | Date | null | undefined,
  now: Date = new Date(),
): DriverLicenseStatus {
  if (!expiry) return { state: "none", days: null };
  const today = todayUtcDateOnly(now);
  if (isDriverLicenseExpiredOn(expiry, today)) return { state: "expired", days: null };
  const days = daysBetweenDateOnly(toExpiryDateOnly(expiry)!, today);
  if (days <= 30) return { state: "soon", days };
  if (days <= 90) return { state: "warning", days };
  return { state: "valid", days };
}

/** Libellé court des jours restants : « Dernier jour » le jour J. */
export function driverLicenseDaysLabel(days: number, suffix = ""): string {
  return days === 0 ? "Dernier jour" : `${days}j${suffix}`;
}
