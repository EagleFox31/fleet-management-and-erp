/**
 * Clé aléatoire d'une soumission de formulaire, renvoyée telle quelle si le même envoi est
 * répété (double clic, nouvel essai après une coupure) : le serveur rejoue au lieu de réécrire.
 * `crypto.randomUUID` n'existe qu'en contexte sécurisé (HTTPS, localhost) : repli sur
 * `crypto.getRandomValues`, disponible partout.
 */
export function newRequestKey(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
