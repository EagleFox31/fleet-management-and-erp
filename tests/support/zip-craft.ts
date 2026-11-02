import zlib from "node:zlib";

/**
 * Archive construite octet par octet : en-tête local et répertoire central réglables
 * indépendamment (drapeaux, tailles, champs extra), data descriptor signé si bit 3.
 */
export interface CraftedEntry {
  name: string;
  data: Uint8Array;
  localFlags?: number;
  localSize?: number;
  localCompressedSize?: number;
  localExtra?: Buffer;
  centralExtra?: Buffer;
}

export function craftZip(entries: CraftedEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const compressed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data) >>> 0;
    const flags = entry.localFlags ?? 0;
    const localExtra = entry.localExtra ?? Buffer.alloc(0);
    const centralExtra = entry.centralExtra ?? Buffer.alloc(0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.localCompressedSize ?? compressed.length, 18);
    local.writeUInt32LE(entry.localSize ?? data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    const descriptor = Buffer.alloc(flags & 0x0008 ? 16 : 0);
    if (descriptor.length) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressed.length, 8);
      descriptor.writeUInt32LE(data.length, 12);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(centralExtra.length, 30);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, localExtra, compressed, descriptor);
    centrals.push(central, name, centralExtra);
    offset += 30 + name.length + localExtra.length + compressed.length + descriptor.length;
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

/** Champ extra ZIP64 (0x0001) annonçant `size` octets décompressés. */
export function zip64Extra(size: number): Buffer {
  const extra = Buffer.alloc(20);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(16, 2);
  extra.writeUInt32LE(size % 2 ** 32, 4);
  extra.writeUInt32LE(Math.floor(size / 2 ** 32), 8);
  return extra;
}

