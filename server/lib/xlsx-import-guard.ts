/**
 * Garde-fous d'un classeur .xlsx avant de le confier à SheetJS.
 *
 * Un .xlsx est un zip contrôlé par l'utilisateur. SheetJS décompresse avec la taille de
 * l'en-tête LOCAL de chaque entrée (0 = tampon sans limite) et ne vérifie qu'après coup :
 * les tailles déclarées ne prouvent donc rien. La garde décompresse réellement chaque
 * entrée avec un plafond d'octets, additionne les octets obtenus et refuse tout zip dont
 * le répertoire central, l'en-tête local ou le contenu réel se contredisent.
 */
import zlib from "node:zlib";
import { AppError } from "./app-error";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;
const LOCAL_ENTRY_SIGNATURE = 0x04034b50;
const EOCD_MIN_LENGTH = 22;
const CENTRAL_ENTRY_MIN_LENGTH = 46;
const LOCAL_HEADER_LENGTH = 30;
const ZIP64_MARKER_16 = 0xffff;
const ZIP64_MARKER_32 = 0xffffffff;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export interface ZipDirectoryStats {
  entries: number;
  /** Octets réellement obtenus en décompressant, jamais les tailles déclarées. */
  uncompressedBytes: number;
}

class ZipUnreadable extends Error {}
class ZipTooLarge extends Error {}

function unreadable(): never {
  throw new ZipUnreadable("zip illisible");
}

/**
 * Cherche l'EOCD comme SheetJS (de `length - 4` vers l'arrière, première signature
 * rencontrée) pour que la garde et le lecteur analysent le même répertoire. Refuse un EOCD
 * trop près de la fin, une longueur de commentaire incohérente ou une seconde signature
 * dans les 22 derniers octets (faux EOCD).
 */
function locateEndOfCentralDirectory(buffer: Buffer): number {
  let eocd = -1;
  for (let i = buffer.length - 4; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0 || eocd + EOCD_MIN_LENGTH > buffer.length) unreadable();
  const commentLength = buffer.readUInt16LE(eocd + 20);
  if (eocd + EOCD_MIN_LENGTH + commentLength !== buffer.length) unreadable();
  for (let i = Math.max(0, buffer.length - EOCD_MIN_LENGTH); i <= buffer.length - 4; i++) {
    if (i !== eocd && buffer.readUInt32LE(i) === EOCD_SIGNATURE) unreadable();
  }
  return eocd;
}

/** Décompresse réellement une entrée, au plus `budget` octets ; renvoie la taille obtenue. */
function measureEntry(method: number, data: Buffer, budget: number): number {
  if (method === METHOD_STORED) {
    if (data.length > budget) throw new ZipTooLarge();
    return data.length;
  }
  try {
    return zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, budget) }).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError) {
      throw new ZipTooLarge();
    }
    return unreadable();
  }
}

function inspect(buffer: Buffer, maxUncompressedBytes: number): ZipDirectoryStats {
  if (buffer.length < EOCD_MIN_LENGTH) unreadable();
  const eocd = locateEndOfCentralDirectory(buffer);

  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const directoryDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const entries = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (diskNumber !== 0 || directoryDisk !== 0) unreadable();
  // SheetJS lit l'octet 8, une autre lecture l'octet 10 : toute divergence est refusée.
  if (entriesOnDisk !== entries) unreadable();
  // Zip64 : jamais produit par un tableur de bureau, refusé comme illisible.
  if (entries === ZIP64_MARKER_16 || directorySize === ZIP64_MARKER_32 || directoryOffset === ZIP64_MARKER_32) {
    unreadable();
  }
  if (directoryOffset + directorySize !== eocd) unreadable();

  let cursor = directoryOffset;
  let walked = 0;
  let totalBytes = 0;
  while (cursor < eocd) {
    if (cursor + CENTRAL_ENTRY_MIN_LENGTH > eocd || buffer.readUInt32LE(cursor) !== CENTRAL_ENTRY_SIGNATURE) {
      unreadable();
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const declaredSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    cursor += CENTRAL_ENTRY_MIN_LENGTH + nameLength + extraLength + commentLength;
    if (cursor > eocd) unreadable();
    walked += 1;

    if (flags & FLAG_ENCRYPTED) unreadable();
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) unreadable();
    if (compressedSize === ZIP64_MARKER_32 || declaredSize === ZIP64_MARKER_32 || localOffset === ZIP64_MARKER_32) {
      unreadable();
    }

    // En-tête local : signature, bornes, méthode et (hors data descriptor) tailles identiques.
    if (localOffset + LOCAL_HEADER_LENGTH > directoryOffset) unreadable();
    if (buffer.readUInt32LE(localOffset) !== LOCAL_ENTRY_SIGNATURE) unreadable();
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    if (localFlags & FLAG_ENCRYPTED) unreadable();
    if (buffer.readUInt16LE(localOffset + 8) !== method) unreadable();
    if (!(localFlags & FLAG_DATA_DESCRIPTOR)) {
      if (buffer.readUInt32LE(localOffset + 18) !== compressedSize) unreadable();
      if (buffer.readUInt32LE(localOffset + 22) !== declaredSize) unreadable();
    }
    const dataStart =
      localOffset + LOCAL_HEADER_LENGTH + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    // Avec data descriptor, la taille compressée du répertoire central sert à découper.
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > directoryOffset) unreadable();

    const actual = measureEntry(method, buffer.subarray(dataStart, dataEnd), maxUncompressedBytes - totalBytes);
    if (method === METHOD_STORED && compressedSize !== declaredSize) unreadable();
    if (actual !== declaredSize) unreadable();
    totalBytes += actual;
    if (totalBytes > maxUncompressedBytes) throw new ZipTooLarge();
  }

  if (cursor !== eocd || walked !== entries) unreadable();
  return { entries: walked, uncompressedBytes: totalBytes };
}

/** Lit et mesure le zip ; `null` si le tampon n'est pas un zip exploitable. */
export function readZipDirectory(
  buffer: Buffer,
  maxUncompressedBytes: number = Number.MAX_SAFE_INTEGER,
): ZipDirectoryStats | null {
  try {
    return inspect(buffer, maxUncompressedBytes);
  } catch (error) {
    if (error instanceof ZipTooLarge) throw error;
    return null;
  }
}

/**
 * Refuse (400 lisible) un fichier qui n'est pas un zip cohérent ou dont le contenu réel,
 * une fois décompressé, dépasse `maxUncompressedBytes`.
 */
export function assertWorkbookArchiveSafe(buffer: Buffer, maxUncompressedBytes: number): void {
  try {
    inspect(buffer, maxUncompressedBytes);
  } catch (error) {
    if (error instanceof ZipTooLarge) {
      const megabytes = Math.round((maxUncompressedBytes / (1024 * 1024)) * 100) / 100;
      throw new AppError(400, `Fichier Excel trop volumineux une fois décompressé : ${megabytes} Mo maximum.`);
    }
    // Lecture hors bornes (RangeError) ou zip incohérent : même refus lisible.
    throw new AppError(400, "Fichier Excel illisible.", { cause: error });
  }
}
