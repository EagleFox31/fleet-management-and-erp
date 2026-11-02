import { zipSync } from "fflate";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { AppError } from "../../../server/lib/app-error";
import { assertWorkbookArchiveSafe, readZipDirectory } from "../../../server/lib/xlsx-import-guard";

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
    assertWorkbookArchiveSafe(buffer, budget);
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

describe("assertWorkbookArchiveSafe", () => {
  it("accepte un classeur valide", () => {
    expect(() => assertWorkbookArchiveSafe(realWorkbook(), FULL_BUDGET)).not.toThrow();
  });

  it("accepte des entrées stockées (méthode 0) sous le budget", () => {
    expect(() => assertWorkbookArchiveSafe(zip({ "a.txt": new Uint8Array(KB) }, 0), BUDGET)).not.toThrow();
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
