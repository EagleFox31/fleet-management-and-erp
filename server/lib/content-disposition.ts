/**
 * En-tête Content-Disposition pour un nom de fichier fourni par l'utilisateur (RFC 6266).
 *
 * Le nom brut entre guillemets casse l'en-tête : un guillemet ouvre un second paramètre, un
 * caractère hors Latin-1 ou un retour à la ligne fait lever `setHeader` (500). On émet donc
 * un `filename` ASCII de repli et, si le nom n'est pas ASCII imprimable, un `filename*`
 * UTF-8 percent-encodé (RFC 8187) qui restitue le nom exact. Même principe que le paquet
 * `content-disposition` d'Express, sans dépendance supplémentaire.
 */
export type DispositionType = "inline" | "attachment";

const DEFAULT_NAME = "document";

function encodeRfc8187(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function contentDisposition(type: DispositionType, filename: string | null | undefined): string {
  const name = filename?.trim() ? filename : DEFAULT_NAME;
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  if (fallback === name) {
    return `${type}; filename="${name}"`;
  }
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeRfc8187(name)}`;
}
