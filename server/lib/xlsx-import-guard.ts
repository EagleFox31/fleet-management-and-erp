/**
 * Garde-fous d'un classeur .xlsx avant de le confier à SheetJS.
 * Un .xlsx est un zip : on lit son répertoire central (sans rien décompresser)
 * pour borner la taille décompressée et refuser un fichier qui n'est pas un zip.
 */
import { AppError } from "./app-error";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;
const EOCD_MIN_LENGTH = 22;
const EOCD_MAX_SEARCH = EOCD_MIN_LENGTH + 0xffff;
const ZIP64_MARKER_16 = 0xffff;
const ZIP64_MARKER_32 = 0xffffffff;

export interface ZipDirectoryStats {
  entries: number;
  uncompressedBytes: number;
}

/** Lit le répertoire central ; `null` si le tampon n'est pas un zip exploitable. */
export function readZipDirectory(buffer: Buffer): ZipDirectoryStats | null {
  if (buffer.length < EOCD_MIN_LENGTH) return null;

  let eocd = -1;
  const lowest = Math.max(0, buffer.length - EOCD_MAX_SEARCH);
  for (let i = buffer.length - EOCD_MIN_LENGTH; i >= lowest; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entries = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  // Zip64 : jamais produit par un tableur de bureau, refusé comme illisible.
  if (entries === ZIP64_MARKER_16 || directorySize === ZIP64_MARKER_32 || directoryOffset === ZIP64_MARKER_32) {
    return null;
  }
  if (directoryOffset + directorySize > eocd) return null;

  let cursor = directoryOffset;
  let uncompressedBytes = 0;
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_ENTRY_SIGNATURE) return null;
    const size = buffer.readUInt32LE(cursor + 24);
    uncompressedBytes += size === ZIP64_MARKER_32 ? Number.MAX_SAFE_INTEGER / 2 : size;
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, uncompressedBytes };
}

/**
 * Refuse (400 lisible) un fichier qui n'est pas un zip ou dont la taille décompressée
 * déclarée dépasse `maxUncompressedBytes`.
 */
export function assertWorkbookArchiveSafe(buffer: Buffer, maxUncompressedBytes: number): void {
  const stats = readZipDirectory(buffer);
  if (!stats) {
    throw new AppError(400, "Fichier Excel illisible.");
  }
  if (stats.uncompressedBytes > maxUncompressedBytes) {
    const megabytes = Math.round(maxUncompressedBytes / (1024 * 1024));
    throw new AppError(400, `Fichier Excel trop volumineux une fois décompressé : ${megabytes} Mo maximum.`);
  }
}
