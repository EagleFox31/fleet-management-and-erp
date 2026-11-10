/**
 * Texte du bandeau « Hors ligne, données du <date/heure> ». Logique pure : le composant
 * et les tests s'appuient sur la même fonction.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** « 10/11/2026 à 14:05 » dans le fuseau de l'appareil. Date absente ou invalide : chaîne vide. */
export function formatOfflineStamp(updatedAt: number | undefined | null): string {
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt) || updatedAt <= 0) return "";
  const d = new Date(updatedAt);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} à ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Échéance à afficher pour un marqueur de reprise : seulement s'il appartient au compte actif de la
 * page et n'est pas échu. Sinon null (aucune session hors ligne à annoncer).
 */
export function resumeDeadlineFor(
  found: { userId: number; expiresAt: number } | null,
  activeUserId: number | null,
  now: number,
): number | null {
  if (!found || activeUserId === null || found.userId !== activeUserId) return null;
  return now > found.expiresAt ? null : found.expiresAt;
}

/**
 * Le bandeau n'existe que hors ligne et avec une lecture réussie à citer. `expiresAt` : fin de la
 * session hors ligne (dernier contact réseau + 72 h), quand le marqueur de reprise la connaît.
 */
export function offlineBannerText(input: {
  online: boolean;
  updatedAt: number | undefined | null;
  expiresAt?: number | null;
}): string | null {
  if (input.online) return null;
  const stamp = formatOfflineStamp(input.updatedAt);
  if (!stamp) return null;
  const until = formatOfflineStamp(input.expiresAt);
  return until ? `Hors ligne, données du ${stamp}, session hors ligne jusqu'au ${until}` : `Hors ligne, données du ${stamp}`;
}
