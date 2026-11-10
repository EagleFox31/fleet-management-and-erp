/**
 * Type réel d'un fichier téléversé, lu sur ses premiers octets (magic bytes) : le MIME déclaré
 * par le client et l'extension du nom ne prouvent rien.
 */
export type UploadMime = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

/** Message du refus pour un contenu qui n'est ni PDF ni image acceptée. */
export const UNREADABLE_UPLOAD_MESSAGE = "Le fichier n'est pas une photo ou un PDF lisible.";
/** Message du refus pour une photo HEIC/HEIF (iPhone) : format non servi par les navigateurs. */
export const HEIC_UPLOAD_MESSAGE = "Format HEIC non accepté : prenez la photo en JPEG ou envoyez un PDF.";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const startsWith = (buf: Uint8Array, bytes: readonly number[], offset = 0): boolean =>
  buf.length >= offset + bytes.length && bytes.every((byte, i) => buf[offset + i] === byte);

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));

/** Type reconnu d'après les octets, ou `null` (SVG, HEIC, exécutable, texte…). */
export function detectUploadMime(buf: Uint8Array): UploadMime | null {
  if (startsWith(buf, ascii("%PDF-"))) return "application/pdf";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buf, PNG)) return "image/png";
  if (startsWith(buf, ascii("RIFF")) && startsWith(buf, ascii("WEBP"), 8)) return "image/webp";
  return null;
}

/** Boîte ISO-BMFF `ftyp` dont la marque est heic/heix/hevc/mif1… : photo HEIC/HEIF. */
export function isHeic(buf: Uint8Array): boolean {
  if (!startsWith(buf, ascii("ftyp"), 4)) return false;
  const brand = String.fromCharCode(...Array.from(buf.subarray(8, 12)));
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand);
}

/** Extension de fichier imposée par le type, jamais tirée du nom d'origine. */
export const EXTENSION_OF_MIME: Record<UploadMime, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
