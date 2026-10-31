function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Echeance proposee : `from` plus `validityMonths` mois, au format `YYYY-MM-DD`.
 * Le jour est ramene a la fin du mois cible quand il n'existe pas
 * (31 janvier + 1 mois = 28 fevrier). `null` si la duree est absente
 * (pas de duree fixe) ou si la date de depart est invalide.
 */
export function proposeDueDate(from: Date, validityMonths: number | null | undefined): string | null {
  if (!validityMonths || validityMonths < 1 || Number.isNaN(from.getTime())) return null;
  const year = from.getFullYear();
  const month = from.getMonth() + validityMonths;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const due = new Date(year, month, Math.min(from.getDate(), lastDay));
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`;
}
