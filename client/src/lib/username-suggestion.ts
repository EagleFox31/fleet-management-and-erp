function removeDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/** Propose un identifiant à partir du nom complet (ex. « Jean Dupont » → « jean.dupont »). */
export function suggestUsernameFromFullName(fullName: string): string {
  const normalized = removeDiacritics(fullName.trim().toLowerCase());
  if (!normalized) {
    return "";
  }

  const parts = normalized
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z0-9-]/g, ""))
    .filter(Boolean);

  if (parts.length === 0) {
    return "";
  }

  const username = parts.length === 1 ? parts[0] : parts.join(".");
  return username.slice(0, 32);
}
