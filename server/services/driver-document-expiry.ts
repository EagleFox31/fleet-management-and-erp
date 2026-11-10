/**
 * Échéances des papiers d'un chauffeur (lot V5a) : permis, CNI, CPC.
 * Pure: pas d'accès base, l'horloge est injectée.
 *
 * Trois paliers : J-30, J-7, échu. Chaque palier a sa propre clé de dédoublonnage ET son propre
 * titre (l'émission écarte aussi une alerte non lue de même titre et même lien : un titre commun
 * ferait taire J-7 tant que J-30 n'est pas lue). Une alerte par palier et par échéance. Un renouvellement change la date
 * et réarme les trois paliers.
 */
import { cpcExpiryDayOf } from "@shared/constants/driver-cpc-eligibility";
import { daysUntilExpiry } from "./document-expiry-rule";

export const DRIVER_DOCUMENT_KINDS = ["license", "cni", "cpc"] as const;
export type DriverDocumentKind = (typeof DRIVER_DOCUMENT_KINDS)[number];

export const DRIVER_DOCUMENT_LABELS: Record<DriverDocumentKind, string> = {
  license: "Permis de conduire",
  cni: "Carte d'identité",
  cpc: "Formation CPC",
};

export const DRIVER_EXPIRY_STAGES = ["j30", "j7", "expired"] as const;
export type DriverExpiryStage = (typeof DRIVER_EXPIRY_STAGES)[number];

export const DRIVER_EXPIRY_WINDOW_DAYS = 30;
export const DRIVER_EXPIRY_URGENT_DAYS = 7;

/**
 * Palier d'une échéance `YYYY-MM-DD`. Le jour J reste valable (comme pour les documents
 * véhicule) : `expired` à partir de J+1. `null` au-delà de 30 jours ou date invalide.
 */
export function driverExpiryStage(expiryDate: string | null | undefined, today: Date): { stage: DriverExpiryStage; days: number } | null {
  if (!expiryDate) return null;
  const days = daysUntilExpiry(expiryDate, today);
  if (days === null) return null;
  if (days < 0) return { stage: "expired", days };
  if (days <= DRIVER_EXPIRY_URGENT_DAYS) return { stage: "j7", days };
  if (days <= DRIVER_EXPIRY_WINDOW_DAYS) return { stage: "j30", days };
  return null;
}

export function driverDocumentDedupeKey(
  driverId: number,
  kind: DriverDocumentKind,
  expiryDate: string,
  stage: DriverExpiryStage,
): string {
  return `driver_doc:${kind}:${stage}:${driverId}:${expiryDate.slice(0, 10)}`;
}

export type DriverExpiryInput = {
  id: number;
  firstName: string;
  lastName: string;
  licenseExpiry: string | null;
  cniExpiry: string | null;
  cpcTrainingDate: string | null;
};

export type DriverExpiryFinding = {
  driverId: number;
  kind: DriverDocumentKind;
  expiry: string;
  stage: DriverExpiryStage;
  days: number;
  title: string;
  message: string;
  priority: "medium" | "high" | "critical";
  dedupeKey: string;
};

function frenchDate(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-");
  return `${d}/${m}/${y}`;
}

/** Échéances d'un chauffeur qui appellent une alerte aujourd'hui. Aucun numéro de pièce n'est repris. */
export function driverExpiryFindings(driver: DriverExpiryInput, today: Date): DriverExpiryFinding[] {
  const expiries: Array<[DriverDocumentKind, string | null]> = [
    ["license", driver.licenseExpiry],
    ["cni", driver.cniExpiry],
    ["cpc", cpcExpiryDayOf(driver.cpcTrainingDate)],
  ];
  const name = `${driver.firstName} ${driver.lastName}`.trim();
  const findings: DriverExpiryFinding[] = [];
  for (const [kind, raw] of expiries) {
    const found = driverExpiryStage(raw, today);
    if (!found || !raw) continue;
    const expiry = raw.slice(0, 10);
    const label = DRIVER_DOCUMENT_LABELS[kind];
    const expired = found.stage === "expired";
    findings.push({
      driverId: driver.id,
      kind,
      expiry,
      stage: found.stage,
      days: found.days,
      title: expired
        ? `${label} expiré (${name}, ${frenchDate(expiry)})`
        : `${label} à renouveler sous ${found.stage === "j7" ? DRIVER_EXPIRY_URGENT_DAYS : DRIVER_EXPIRY_WINDOW_DAYS} jours (${name}, ${frenchDate(expiry)})`,
      message: expired
        ? `Chauffeur ${name} - ${label} expiré depuis ${Math.abs(found.days)} jour(s)`
        : found.days === 0
          ? `Chauffeur ${name} - ${label} expire ce soir : dernier jour de validité`
          : `Chauffeur ${name} - ${label} expire dans ${found.days} jour(s)`,
      priority: expired ? "critical" : found.stage === "j7" ? "high" : "medium",
      dedupeKey: driverDocumentDedupeKey(driver.id, kind, expiry, found.stage),
    });
  }
  return findings;
}
