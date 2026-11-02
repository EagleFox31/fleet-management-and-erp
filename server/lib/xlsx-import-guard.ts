/**
 * Garde-fous d'un classeur .xlsx avant de le confier à SheetJS.
 *
 * Un .xlsx est un zip contrôlé par l'utilisateur. SheetJS dimensionne sa décompression
 * sur l'en-tête LOCAL de chaque entrée (taille déclarée, ou extra ZIP64 0x0001) et ne
 * traite un écart avec le data descriptor que comme un avertissement : valider le zip
 * puis laisser SheetJS relire le tampon téléversé laisse un écart entre deux parseurs,
 * déjà exploité deux fois (taille sous-déclarée, puis bit 3 + taille locale géante).
 *
 * La garde ne se contente donc pas de valider : elle décompresse réellement chaque entrée
 * (plafond d'octets cumulé), puis reconstruit une archive NEUVE à partir des seuls
 * contenus obtenus et des noms d'entrées (`fflate.zipSync`, entrées stockées, sans data
 * descriptor ni ZIP64). SheetJS ne lit que cette archive canonique, dont les tailles sont
 * vraies par construction. Les refus stricts restent en amont parce qu'ils sont peu coûteux.
 */
import zlib from "node:zlib";
import { zipSync, type Zippable } from "fflate";
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
const EXTRA_ZIP64 = 0x0001;
/** Date fixe des entrées reconstruites : même contenu, même archive. */
const CANONICAL_MTIME = new Date(2000, 0, 1);
const utf8 = new TextDecoder("utf-8", { fatal: true });

export interface ZipDirectoryStats {
  entries: number;
  /** Octets réellement obtenus en décompressant, jamais les tailles déclarées. */
  uncompressedBytes: number;
}

interface ZipEntryContent {
  name: string;
  data: Uint8Array;
}

class ZipUnreadable extends Error {}
class ZipTooLarge extends Error {}

function unreadable(): never {
  throw new ZipUnreadable("zip illisible");
}

/**
 * Cherche l'EOCD comme SheetJS (de `length - 4` vers l'arrière, première signature
 * rencontrée). Refuse un EOCD trop près de la fin, une longueur de commentaire incohérente
 * ou une seconde signature dans les 22 derniers octets (faux EOCD).
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

/** Décompresse réellement une entrée, au plus `budget` octets ; renvoie le contenu obtenu. */
function extractEntry(method: number, data: Buffer, budget: number): Uint8Array {
  if (method === METHOD_STORED) {
    if (data.length > budget) throw new ZipTooLarge();
    return data;
  }
  try {
    return zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, budget) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError) {
      throw new ZipTooLarge();
    }
    return unreadable();
  }
}

/** Refuse un champ extra mal formé ou portant un bloc ZIP64 (0x0001). */
function assertExtraField(buffer: Buffer, start: number, length: number): void {
  const end = start + length;
  let cursor = start;
  while (cursor < end) {
    if (cursor + 4 > end) unreadable();
    const id = buffer.readUInt16LE(cursor);
    const size = buffer.readUInt16LE(cursor + 2);
    cursor += 4 + size;
    if (cursor > end || id === EXTRA_ZIP64) unreadable();
  }
}

function decodeName(raw: Buffer): string {
  let name: string;
  try {
    name = utf8.decode(raw);
  } catch {
    return unreadable();
  }
  // `__proto__` serait une clé spéciale dans l'objet que fflate remplit.
  if (name.length === 0 || name === "__proto__") unreadable();
  return name;
}

function inspect(buffer: Buffer, maxUncompressedBytes: number): { entries: ZipEntryContent[]; uncompressedBytes: number } {
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
  const contents: ZipEntryContent[] = [];
  const names = new Set<string>();
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
    const nameStart = cursor + CENTRAL_ENTRY_MIN_LENGTH;
    cursor = nameStart + nameLength + extraLength + commentLength;
    if (cursor > eocd) unreadable();
    walked += 1;

    if (flags & FLAG_ENCRYPTED) unreadable();
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) unreadable();
    if (compressedSize === ZIP64_MARKER_32 || declaredSize === ZIP64_MARKER_32 || localOffset === ZIP64_MARKER_32) {
      unreadable();
    }
    assertExtraField(buffer, nameStart + nameLength, extraLength);
    const name = decodeName(buffer.subarray(nameStart, nameStart + nameLength));
    if (names.has(name)) unreadable();
    names.add(name);

    // En-tête local : signature, bornes, méthode, extra sans ZIP64, tailles identiques au
    // central ; avec data descriptor (bit 3), tailles locales à 0 ou identiques au central.
    if (localOffset + LOCAL_HEADER_LENGTH > directoryOffset) unreadable();
    if (buffer.readUInt32LE(localOffset) !== LOCAL_ENTRY_SIGNATURE) unreadable();
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    if (localFlags & FLAG_ENCRYPTED) unreadable();
    if (buffer.readUInt16LE(localOffset + 8) !== method) unreadable();
    const localCompressed = buffer.readUInt32LE(localOffset + 18);
    const localDeclared = buffer.readUInt32LE(localOffset + 22);
    const sizesMatch = localCompressed === compressedSize && localDeclared === declaredSize;
    const sizesDeferred = (localFlags & FLAG_DATA_DESCRIPTOR) !== 0 && localCompressed === 0 && localDeclared === 0;
    if (!sizesMatch && !sizesDeferred) unreadable();
    const localExtraStart = localOffset + LOCAL_HEADER_LENGTH + buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    if (localExtraStart + localExtraLength > directoryOffset) unreadable();
    assertExtraField(buffer, localExtraStart, localExtraLength);
    const dataStart = localExtraStart + localExtraLength;
    // Avec data descriptor, la taille compressée du répertoire central sert à découper.
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > directoryOffset) unreadable();

    const data = extractEntry(method, buffer.subarray(dataStart, dataEnd), maxUncompressedBytes - totalBytes);
    if (method === METHOD_STORED && compressedSize !== declaredSize) unreadable();
    if (data.length !== declaredSize) unreadable();
    totalBytes += data.length;
    if (totalBytes > maxUncompressedBytes) throw new ZipTooLarge();
    contents.push({ name, data });
  }

  if (cursor !== eocd || walked !== entries) unreadable();
  return { entries: contents, uncompressedBytes: totalBytes };
}

/** Archive neuve à partir des seuls contenus réels : entrées stockées, tailles vraies. */
function rebuild(entries: ZipEntryContent[]): Buffer {
  const files: Zippable = Object.create(null);
  for (const entry of entries) files[entry.name] = entry.data;
  return Buffer.from(zipSync(files, { level: 0, mtime: CANONICAL_MTIME }));
}

/** Lit et mesure le zip ; `null` si le tampon n'est pas un zip exploitable. */
export function readZipDirectory(
  buffer: Buffer,
  maxUncompressedBytes: number = Number.MAX_SAFE_INTEGER,
): ZipDirectoryStats | null {
  try {
    const { entries, uncompressedBytes } = inspect(buffer, maxUncompressedBytes);
    return { entries: entries.length, uncompressedBytes };
  } catch (error) {
    if (error instanceof ZipTooLarge) throw error;
    return null;
  }
}

/**
 * Renvoie l'archive canonique à confier à SheetJS, à la place du tampon téléversé.
 * Refuse (400 lisible) un fichier qui n'est pas un zip cohérent ou dont le contenu réel,
 * une fois décompressé, dépasse `maxUncompressedBytes`.
 */
export function canonicalWorkbookArchive(buffer: Buffer, maxUncompressedBytes: number): Buffer {
  try {
    return rebuild(inspect(buffer, maxUncompressedBytes).entries);
  } catch (error) {
    if (error instanceof ZipTooLarge) {
      const megabytes = Math.round((maxUncompressedBytes / (1024 * 1024)) * 100) / 100;
      throw new AppError(400, `Fichier Excel trop volumineux une fois décompressé : ${megabytes} Mo maximum.`);
    }
    // Lecture hors bornes (RangeError), zip incohérent ou reconstruction impossible : même refus.
    throw new AppError(400, "Fichier Excel illisible.", { cause: error });
  }
}
