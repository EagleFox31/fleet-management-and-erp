/**
 * Lecture des nombres servis par les routes de statistiques.
 *
 * Les agrégats Postgres arrivent souvent en texte (`SUM` d'un integer ou d'un numeric) : ils
 * sont convertis une seule fois. Une valeur illisible ou absente devient `null`, jamais 0, et
 * l'écran l'affiche « Indisponible ».
 */
const NUMERIC_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function parseStatNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  return NUMERIC_TEXT.test(text) ? Number(text) : null;
}

/** Champ numérique d'un objet servi ; `null` si l'objet manque ou si la valeur est illisible. */
export function statField(source: unknown, key: string): number | null {
  if (!source || typeof source !== "object") return null;
  return parseStatNumber((source as Record<string, unknown>)[key]);
}

/** Somme ; `null` dès qu'un terme est inconnu, jamais une somme partielle. */
export function sumKnown(values: readonly (number | null)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

/** Somme d'un champ sur une liste ; `null` si la liste manque ou si un élément est illisible. */
export function sumField(list: readonly unknown[] | null, key: string): number | null {
  return list ? sumKnown(list.map((item) => statField(item, key))) : null;
}
