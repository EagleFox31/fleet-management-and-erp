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

/** Le bandeau n'existe que hors ligne et avec une lecture réussie à citer. */
export function offlineBannerText(input: { online: boolean; updatedAt: number | undefined | null }): string | null {
  if (input.online) return null;
  const stamp = formatOfflineStamp(input.updatedAt);
  return stamp ? `Hors ligne, données du ${stamp}` : null;
}
