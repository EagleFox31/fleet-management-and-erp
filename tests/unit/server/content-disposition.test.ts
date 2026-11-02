import { describe, expect, it } from "vitest";
import { contentDisposition } from "../../../server/lib/content-disposition";

function decodedName(header: string): string {
  const extended = header.match(/filename\*=UTF-8''([^;]+)/);
  return extended ? decodeURIComponent(extended[1]) : header.match(/filename="([^"]*)"/)![1];
}

describe("contentDisposition", () => {
  it("garde un nom ASCII simple tel quel", () => {
    expect(contentDisposition("inline", "facture-2026.pdf")).toBe('inline; filename="facture-2026.pdf"');
    expect(contentDisposition("attachment", "a b.pdf")).toBe('attachment; filename="a b.pdf"');
  });

  it.each([
    ["accents", "Carte grise é.pdf"],
    ["hors Latin-1", "车辆 Ω.pdf"],
    ["guillemet", 'devis".pdf; filename="autre.exe'],
    ["antislash", "a\\b.pdf"],
    ["retour à la ligne", "a\r\nX-Injecte: 1.pdf"],
    ["apostrophe et parenthèses", "l'état (copie)*.pdf"],
  ])("restitue le nom exact (%s) sans caractère interdit dans l'en-tête", (_label, name) => {
    const header = contentDisposition("inline", name);
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(header.match(/filename="/g)).toHaveLength(1);
    expect(decodedName(header)).toBe(name);
  });

  it("donne un nom par défaut quand le nom est vide ou absent", () => {
    expect(contentDisposition("attachment", "")).toBe('attachment; filename="document"');
    expect(contentDisposition("attachment", null)).toBe('attachment; filename="document"');
  });
});
