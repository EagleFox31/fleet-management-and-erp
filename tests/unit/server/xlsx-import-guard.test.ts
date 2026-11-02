import { zipSync } from "fflate";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { AppError } from "../../../server/lib/app-error";
import { assertWorkbookArchiveSafe, readZipDirectory } from "../../../server/lib/xlsx-import-guard";

/** Niveau U : lecture du répertoire central d'un .xlsx avant parse. */

function realWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a", "b"], [1, 2]]), "S");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("readZipDirectory", () => {
  it("lit un classeur réel", () => {
    const stats = readZipDirectory(realWorkbook());
    expect(stats).not.toBeNull();
    expect(stats!.entries).toBeGreaterThan(2);
    expect(stats!.uncompressedBytes).toBeGreaterThan(0);
  });

  it("somme la taille décompressée déclarée", () => {
    const zip = Buffer.from(zipSync({ "a.txt": new Uint8Array(1000), "b.txt": new Uint8Array(500) }));
    expect(readZipDirectory(zip)).toEqual({ entries: 2, uncompressedBytes: 1500 });
  });

  it("refuse ce qui n'est pas un zip", () => {
    expect(readZipDirectory(Buffer.from("pas un zip du tout, juste du texte"))).toBeNull();
    expect(readZipDirectory(Buffer.alloc(10))).toBeNull();
  });

  it("refuse un zip tronqué", () => {
    const zip = realWorkbook();
    expect(readZipDirectory(zip.subarray(0, Math.floor(zip.length / 2)))).toBeNull();
  });
});

describe("assertWorkbookArchiveSafe", () => {
  it("accepte un classeur normal", () => {
    expect(() => assertWorkbookArchiveSafe(realWorkbook(), 50 * 1024 * 1024)).not.toThrow();
  });

  it("refuse une décompression excessive (400 lisible)", () => {
    const bomb = Buffer.from(zipSync({ "xl/big.xml": new Uint8Array(8 * 1024 * 1024) }));
    expect(bomb.length).toBeLessThan(100 * 1024);
    try {
      assertWorkbookArchiveSafe(bomb, 5 * 1024 * 1024);
      throw new Error("aurait dû refuser");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(400);
      expect((error as AppError).message).toMatch(/décompressé/);
    }
  });

  it("refuse un fichier non zip en 400", () => {
    expect(() => assertWorkbookArchiveSafe(Buffer.from("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), 1000)).toThrow(/illisible/);
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
