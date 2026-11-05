import { getDriverCpcEligibility, type CpcIneligibleCode } from "../../shared/constants/driver-cpc-eligibility";

/**
 * Éligibilité CPC d'un chauffeur affecté, calculée côté serveur pour les lectures de missions.
 *
 * Données personnelles (cloison de #127) :
 * - la date de formation ne sort jamais : seul le verdict et un libellé fixe, sans date ;
 * - un client ne reçoit rien (la route est déjà réservée au personnel, garde en profondeur) ;
 * - un chauffeur ne reçoit le verdict que pour sa propre fiche, jamais pour celle d'un collègue.
 */

export type CpcReader = { id: number; role: string } | undefined;

type DriverWithCpcInputs = {
  id?: number | null;
  cpcStatus?: string | null;
  cpcTrainingDate?: string | Date | null;
} & Record<string, unknown>;

export interface DriverCpcVerdict {
  cpcEligible: boolean;
  /** Motif stable (lu par les écrans et les contrats) ; null quand éligible. */
  cpcIneligibleCode: CpcIneligibleCode | null;
  /** Libellé fixe du motif, sans date. */
  cpcIneligibleReason: string | null;
}

/**
 * Copie du chauffeur sans `cpcTrainingDate`, avec `cpcEligible` / `cpcIneligibleReason` quand le
 * lecteur y a droit. `driverScope` : fiches du lecteur s'il est chauffeur, `undefined` sinon.
 */
export function withDriverCpcVerdict<D extends DriverWithCpcInputs>(
  driver: D | null | undefined,
  reader: CpcReader,
  driverScope: number[] | undefined,
  today?: string,
): (Omit<D, "cpcTrainingDate"> & Partial<DriverCpcVerdict>) | null {
  if (!driver) return null;
  const { cpcTrainingDate, ...rest } = driver;
  const mayRead =
    reader !== undefined &&
    reader.role !== "client" &&
    (driverScope === undefined || (typeof driver.id === "number" && driverScope.includes(driver.id)));
  if (!mayRead) return rest;
  const verdict = getDriverCpcEligibility({ cpcStatus: driver.cpcStatus, cpcTrainingDate }, today);
  return {
    ...rest,
    cpcEligible: verdict.eligible,
    cpcIneligibleCode: verdict.eligible ? null : (verdict.code ?? null),
    cpcIneligibleReason: verdict.eligible ? null : (verdict.label ?? null),
  };
}

/** Applique `withDriverCpcVerdict` au `driver` de chaque affectation. */
export function withAssignmentsCpcVerdict<A extends { driver?: DriverWithCpcInputs | null }>(
  rows: A[],
  reader: CpcReader,
  driverScope: number[] | undefined,
): Array<Omit<A, "driver"> & { driver: ReturnType<typeof withDriverCpcVerdict> }> {
  return rows.map((row) => ({ ...row, driver: withDriverCpcVerdict(row.driver, reader, driverScope) }));
}
