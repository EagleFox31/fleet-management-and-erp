import { craftZip, zip64Extra, type CraftedEntry } from "../../support/zip-craft";
import { unzipSync, zipSync } from "fflate";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { AppError } from "../../../server/lib/app-error";
import { canonicalWorkbookArchive, readZipDirectory } from "../../../server/lib/xlsx-import-guard";

/**
 * Niveau U : la garde mesure le contenu RÉEL d'un .xlsx (décompression plafonnée) et ne
 * croit ni les tailles déclarées, ni un répertoire central en désaccord avec l'en-tête local.
 * Les fixtures sont générées en mémoire ; le budget est injecté (quelques Ko, pas 50 Mo).
 */

const KB = 1024;
const BUDGET = 50 * KB;
const FULL_BUDGET = 50 * 1024 * KB;

function realWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a", "b"], [1, 2]]), "S");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function zip(files: Record<string, Uint8Array>, level: 0 | 6 = 6): Buffer {
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [name, data] of Object.entries(files)) entries[name] = [data, { level }];
  return Buffer.from(zipSync(entries));
}

const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

/** Position, dans le répertoire central, de l'entrée portant ce nom. */
function centralEntry(z: Buffer, name: string): { cd: number; local: number } {
  const eocd = z.lastIndexOf(EOCD);
  let cursor = z.readUInt32LE(eocd + 16);
  for (let i = 0; i < z.readUInt16LE(eocd + 10); i++) {
    const nameLength = z.readUInt16LE(cursor + 28);
    if (z.subarray(cursor + 46, cursor + 46 + nameLength).toString() === name) {
      return { cd: cursor, local: z.readUInt32LE(cursor + 42) };
    }
    cursor += 46 + nameLength + z.readUInt16LE(cursor + 30) + z.readUInt16LE(cursor + 32);
  }
  throw new Error(`entrée ${name} introuvable`);
}

function expectRefused(buffer: Buffer, pattern: RegExp, budget = BUDGET): void {
  let thrown: unknown;
  try {
    canonicalWorkbookArchive(buffer, budget);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AppError);
  expect((thrown as AppError).status).toBe(400);
  expect((thrown as AppError).message).toMatch(pattern);
}

describe("readZipDirectory", () => {
  it("lit un classeur réel", () => {
    const stats = readZipDirectory(realWorkbook());
    expect(stats).not.toBeNull();
    expect(stats!.entries).toBeGreaterThan(2);
    expect(stats!.uncompressedBytes).toBeGreaterThan(0);
  });

  it("somme les octets réels décompressés", () => {
    const z = zip({ "a.txt": new Uint8Array(1000), "b.txt": new Uint8Array(500) });
    expect(readZipDirectory(z)).toEqual({ entries: 2, uncompressedBytes: 1500 });
  });

  it("refuse ce qui n'est pas un zip", () => {
    expect(readZipDirectory(Buffer.from("pas un zip du tout, juste du texte"))).toBeNull();
    expect(readZipDirectory(Buffer.alloc(10))).toBeNull();
  });

  it("refuse un zip tronqué", () => {
    const z = realWorkbook();
    expect(readZipDirectory(z.subarray(0, Math.floor(z.length / 2)))).toBeNull();
  });
});

describe("canonicalWorkbookArchive", () => {
  it("accepte un classeur valide", () => {
    expect(() => canonicalWorkbookArchive(realWorkbook(), FULL_BUDGET)).not.toThrow();
  });

  it("accepte des entrées stockées (méthode 0) sous le budget", () => {
    expect(() => canonicalWorkbookArchive(zip({ "a.txt": new Uint8Array(KB) }, 0), BUDGET)).not.toThrow();
  });

  it("refuse une décompression excessive honnête (400 lisible)", () => {
    const bomb = zip({ "xl/big.xml": new Uint8Array(200 * KB) });
    expect(bomb.length).toBeLessThan(BUDGET);
    expectRefused(bomb, /décompressé/);
  });

  it("refuse une entrée stockée plus grande que le budget", () => {
    expectRefused(zip({ "a.bin": new Uint8Array(BUDGET + 1) }, 0), /décompressé/);
  });

  it("refuse la somme de plusieurs entrées qui dépasse le budget", () => {
    const z = zip({ "a.bin": new Uint8Array(30 * KB), "b.bin": new Uint8Array(30 * KB) });
    expectRefused(z, /décompressé/);
  });

  it("refuse un fichier non zip en 400", () => {
    expectRefused(Buffer.from("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), /illisible/);
  });

  it("taille annoncée sous-déclarée (répertoire central = 1, local = 0)", () => {
    const z = zip({ "ok.txt": new Uint8Array(10), "xl/big.bin": new Uint8Array(200 * KB) });
    const { cd, local } = centralEntry(z, "xl/big.bin");
    z.writeUInt32LE(1, cd + 24);
    z.writeUInt32LE(0, local + 22);
    expectRefused(z, /illisible|décompressé/);
  });

  it("taille sous-déclarée partout (central = local = 1) : la décompression réelle tranche", () => {
    const z = zip({ "ok.txt": new Uint8Array(10), "xl/big.bin": new Uint8Array(200 * KB) });
    const { cd, local } = centralEntry(z, "xl/big.bin");
    z.writeUInt32LE(1, cd + 24);
    z.writeUInt32LE(1, local + 22);
    expectRefused(z, /illisible|décompressé/);
  });

  it("compteur EOCD divergent (octet 8 différent de l'octet 10)", () => {
    const z = zip({ "ok.txt": new Uint8Array(10), "xl/big.bin": new Uint8Array(200 * KB) });
    z.writeUInt16LE(1, z.lastIndexOf(EOCD) + 10);
    expectRefused(z, /illisible/);
  });

  it("nombre d'entrées déclaré différent des entrées du répertoire (deux compteurs à 1)", () => {
    const z = zip({ "ok.txt": new Uint8Array(10), "xl/big.bin": new Uint8Array(200 * KB) });
    const eocd = z.lastIndexOf(EOCD);
    z.writeUInt16LE(1, eocd + 8);
    z.writeUInt16LE(1, eocd + 10);
    expectRefused(z, /illisible/, FULL_BUDGET);
  });

  it("faux EOCD (signature seule) en fin de fichier", () => {
    expectRefused(Buffer.concat([realWorkbook(), EOCD]), /illisible/, FULL_BUDGET);
  });

  it("faux EOCD complet de 22 octets en fin de fichier", () => {
    const fake = Buffer.alloc(22);
    EOCD.copy(fake);
    expectRefused(Buffer.concat([realWorkbook(), fake]), /illisible/, FULL_BUDGET);
  });

  it("refuse une méthode de compression autre que 0 et 8", () => {
    const z = zip({ "a.txt": new Uint8Array(100) });
    const { cd, local } = centralEntry(z, "a.txt");
    z.writeUInt16LE(12, cd + 10);
    z.writeUInt16LE(12, local + 8);
    expectRefused(z, /illisible/);
  });

  it("refuse un en-tête local dont la méthode diverge du répertoire central", () => {
    const z = zip({ "a.txt": new Uint8Array(100) });
    z.writeUInt16LE(0, centralEntry(z, "a.txt").local + 8);
    expectRefused(z, /illisible/);
  });

  it("refuse un en-tête local sans signature", () => {
    const z = zip({ "a.txt": new Uint8Array(100) });
    z.writeUInt32LE(0, centralEntry(z, "a.txt").local);
    expectRefused(z, /illisible/);
  });

  it("refuse un décalage local hors du fichier", () => {
    const z = zip({ "a.txt": new Uint8Array(100) });
    z.writeUInt32LE(z.length + 100, centralEntry(z, "a.txt").cd + 42);
    expectRefused(z, /illisible/);
  });
});

function workbookEntries(): CraftedEntry[] {
  const files = unzipSync(realWorkbook());
  return Object.entries(files).map(([name, data]) => ({ name, data }));
}

describe("Contournements par écart garde / SheetJS (data descriptor, ZIP64)", () => {
  it("témoin : l'archive fabriquée sans piège est acceptée", () => {
    expect(() => canonicalWorkbookArchive(craftZip(workbookEntries()), FULL_BUDGET)).not.toThrow();
  });

  it("dd300 : bit 3 + taille locale 300 Mo (central honnête) refusé", () => {
    const entries = workbookEntries().map((e) =>
      e.name === "xl/worksheets/sheet1.xml" ? { ...e, localFlags: 0x0008, localSize: 300 * 1024 * 1024 } : e,
    );
    expectRefused(craftZip(entries), /illisible/, FULL_BUDGET);
  });

  it("d5 : extra ZIP64 local + bit 3 sur une entrée vide refusé", () => {
    const entries: CraftedEntry[] = [
      ...workbookEntries(),
      { name: "xl/media/j0.bin", data: new Uint8Array(0), localFlags: 0x0008, localExtra: zip64Extra(5 * 2 ** 30) },
    ];
    expectRefused(craftZip(entries), /illisible/, FULL_BUDGET);
  });

  it("extra ZIP64 dans le répertoire central refusé", () => {
    const entries: CraftedEntry[] = [
      ...workbookEntries(),
      { name: "xl/media/j0.bin", data: new Uint8Array(10), centralExtra: zip64Extra(10) },
    ];
    expectRefused(craftZip(entries), /illisible/, FULL_BUDGET);
  });

  it("bit 3 avec tailles locales à 0 (cas légitime) accepté", () => {
    const entries = workbookEntries().map((e) => ({ ...e, localFlags: 0x0008, localSize: 0, localCompressedSize: 0 }));
    expect(() => canonicalWorkbookArchive(craftZip(entries), FULL_BUDGET)).not.toThrow();
  });

  it("nom d'entrée en double refusé", () => {
    const entries = workbookEntries();
    expectRefused(craftZip([...entries, { ...entries[0] }]), /illisible/, FULL_BUDGET);
  });

  it("nom d'entrée vide refusé", () => {
    expectRefused(craftZip([...workbookEntries(), { name: "", data: new Uint8Array(1) }]), /illisible/, FULL_BUDGET);
  });
});

describe("Archive canonique rendue à SheetJS", () => {
  /** Chaque en-tête local de l'archive : drapeaux, tailles, extra et contenu réel. */
  function localHeaders(z: Buffer) {
    const real = unzipSync(z);
    const eocd = z.lastIndexOf(EOCD);
    let cursor = z.readUInt32LE(eocd + 16);
    const headers = [];
    for (let i = 0; i < z.readUInt16LE(eocd + 10); i++) {
      const nameLength = z.readUInt16LE(cursor + 28);
      const name = z.subarray(cursor + 46, cursor + 46 + nameLength).toString();
      const local = z.readUInt32LE(cursor + 42);
      headers.push({
        name,
        flags: z.readUInt16LE(local + 6),
        localCompressed: z.readUInt32LE(local + 18),
        localSize: z.readUInt32LE(local + 22),
        localExtra: z.readUInt16LE(local + 28),
        centralExtra: z.readUInt16LE(cursor + 30),
        centralSize: z.readUInt32LE(cursor + 24),
        realSize: real[name].length,
      });
      cursor += 46 + nameLength + z.readUInt16LE(cursor + 30) + z.readUInt16LE(cursor + 32);
    }
    return headers;
  }

  it("bit 3 légitime en entrée : sortie sans data descriptor ni extra, tailles locales = tailles réelles", () => {
    const entries = workbookEntries().map((e) => ({ ...e, localFlags: 0x0008, localSize: 0, localCompressedSize: 0 }));
    const canonical = canonicalWorkbookArchive(craftZip(entries), FULL_BUDGET);
    const headers = localHeaders(canonical);
    expect(headers.length).toBe(entries.length);
    for (const h of headers) {
      expect(h.flags & 0x0008).toBe(0);
      expect(h.localExtra).toBe(0);
      expect(h.centralExtra).toBe(0);
      expect(h.localSize).toBe(h.realSize);
      expect(h.localCompressed).toBe(h.realSize);
      expect(h.centralSize).toBe(h.realSize);
    }
  });

  it("SheetJS relit l'archive canonique avec les données d'origine", () => {
    const canonical = canonicalWorkbookArchive(realWorkbook(), FULL_BUDGET);
    const read = XLSX.read(canonical, { type: "buffer", dense: true, cellFormula: false });
    expect(XLSX.utils.sheet_to_json(read.Sheets[read.SheetNames[0]], { header: 1 })).toEqual([["a", "b"], [1, 2]]);
  });

  it("la sortie ne réutilise pas le tampon téléversé et est stable d'un appel à l'autre", () => {
    const upload = realWorkbook();
    const first = canonicalWorkbookArchive(upload, FULL_BUDGET);
    expect(first.equals(upload)).toBe(false);
    expect(canonicalWorkbookArchive(upload, FULL_BUDGET).equals(first)).toBe(true);
    expect(canonicalWorkbookArchive(first, FULL_BUDGET).equals(first)).toBe(true);
  });
});

describe("SheetJS 0.20 : durcissement de lecture", () => {
  it("un en-tête __proto__ ne pollue pas Object.prototype", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["__proto__", "constructor", "polluted"], ["x", "y", "z"]]),
      "S",
    );
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const read = XLSX.read(buf, { type: "buffer", dense: true, cellFormula: false });
    XLSX.utils.sheet_to_json(read.Sheets[read.SheetNames[0]]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(Object.keys(Object.prototype)).toEqual([]);
  });
});
