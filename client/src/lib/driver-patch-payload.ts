/**
 * Corps d'un PATCH de fiche chauffeur.
 *
 * `cpcTrainingDate` ne part que s'il a changé : le renvoyer à l'identique sur un simple changement
 * de nom réécrit le statut CPC côté serveur (recalcul) et fait échouer un chauffeur dont la date est
 * ancienne ou absente sur une saisie qui n'y touche pas.
 */

function dateOnly(value: string | null | undefined): string {
  return value ? (value.split("T")[0] ?? "") : "";
}

/** Vrai si la date saisie diffère de la date chargée (absente, vide et `null` sont équivalentes). */
export function isCpcTrainingDateChanged(
  next: string | null | undefined,
  loaded: string | null | undefined,
): boolean {
  return dateOnly(next) !== dateOnly(loaded);
}

/** Copie du corps sans `cpcTrainingDate` quand elle est inchangée par rapport à la valeur chargée. */
export function buildDriverPatchPayload<T extends { cpcTrainingDate?: string | null }>(
  payload: T,
  loadedCpcTrainingDate: string | null | undefined,
): T {
  if (isCpcTrainingDateChanged(payload.cpcTrainingDate, loadedCpcTrainingDate)) return { ...payload };
  const { cpcTrainingDate: _unchanged, ...rest } = payload;
  return rest as T;
}
