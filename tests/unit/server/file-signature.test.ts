import { describe, expect, it } from "vitest";
import { detectUploadMime, isHeic } from "../../../server/lib/file-signature";

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => Uint8Array.from(Buffer.from(value, "latin1"));

describe("detectUploadMime", () => {
  it("reconnaît un PDF, un JPEG, un PNG et un WebP d'après leurs octets", () => {
    expect(detectUploadMime(text("%PDF-1.7\n"))).toBe("application/pdf");
    expect(detectUploadMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe("image/jpeg");
    expect(detectUploadMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(detectUploadMime(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))).toBe("image/webp");
  });

  it("refuse SVG, HTML, texte, exécutable, WAV (RIFF sans WEBP) et contenu vide ou tronqué", () => {
    expect(detectUploadMime(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectUploadMime(text("<html><script>alert(1)</script>"))).toBeNull();
    expect(detectUploadMime(text("MZ\u0090\u0000"))).toBeNull();
    expect(detectUploadMime(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt ")]))).toBeNull();
    expect(detectUploadMime(new Uint8Array())).toBeNull();
    expect(detectUploadMime(bytes(0x89, 0x50, 0x4e))).toBeNull();
    expect(detectUploadMime(text("%PDF"))).toBeNull();
  });
});

describe("isHeic", () => {
  const ftyp = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftyp"), Buffer.from(brand), Buffer.alloc(8)]);
  it("reconnaît une photo HEIC/HEIF et pas un MP4", () => {
    expect(isHeic(ftyp("heic"))).toBe(true);
    expect(isHeic(ftyp("mif1"))).toBe(true);
    expect(isHeic(ftyp("isom"))).toBe(false);
    expect(isHeic(text("%PDF-1.4"))).toBe(false);
    expect(detectUploadMime(ftyp("heic"))).toBeNull();
  });
});
