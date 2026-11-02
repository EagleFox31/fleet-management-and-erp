/**
 * Échappe `%`, `_` et `\` d'une saisie avant un `LIKE` / `ILIKE` : sans cela,
 * l'utilisateur écrit des jokers au lieu de chercher du texte. Retire aussi
 * l'octet nul, que PostgreSQL refuse dans une chaîne.
 */
export function escapeLike(input: string): string {
  return input.replace(/\u0000/g, "").replace(/[\\%_]/g, (c) => "\\" + c);
}
