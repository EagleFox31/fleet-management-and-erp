import zlib from "node:zlib";

/**
 * Lecture minimale d'une archive ZIP en memoire (repertoire central), pour verifier
 * le contenu d'un export. Methodes 0 (stocke) et 8 (deflate) seulement.
 */
export function readZip(buffer: Buffer): Map<string, Buffer> {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("archive ZIP sans fin de repertoire central");
  const count = buffer.readUInt16LE(eocd + 10);
  let pos = buffer.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error("entree de repertoire central invalide");
    const method = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLength).toString("utf8");
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    out.set(name, method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw));
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}
