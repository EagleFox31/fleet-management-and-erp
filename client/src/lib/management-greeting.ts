export type DayPeriodGreeting = "Bonjour" | "Bon après-midi" | "Bonsoir";

/** Salutation selon l'heure locale (matin / après-midi / soir). */
export function resolveDayPeriodGreeting(date = new Date()): DayPeriodGreeting {
  const hour = date.getHours();

  if (hour >= 18 || hour < 5) {
    return "Bonsoir";
  }
  if (hour >= 12) {
    return "Bon après-midi";
  }
  return "Bonjour";
}

/** Dernier segment du nom complet, pour « M. Dupont ». */
export function extractFormalLastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "";
  }
  return parts[parts.length - 1];
}

export function formatManagementGreeting(fullName: string, date = new Date()): string {
  const lastName = extractFormalLastName(fullName);
  if (!lastName) {
    return "Tableau de bord Direction";
  }

  return `${resolveDayPeriodGreeting(date)} M. ${lastName}`;
}
