import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { buildWorkOrderDocx, workOrderDocFilename, type WorkOrderDocData } from "../../../../server/lib/word";

const base: WorkOrderDocData = {
  id: 62,
  title: "Vidange et contrôle freins",
  description: "Révision complète à 100 000 km",
  diagnosis: null,
  statusLabel: "En cours",
  priorityLabel: "Élevée",
  vehicle: { registration: "LT-123-AB", brand: "Renault", model: "Master" },
  technicianName: "Étienne Mbarga",
  startDate: new Date("2026-11-02T08:00:00Z"),
  endDate: null,
  lines: [
    { label: "Vidange moteur", technicianName: "Étienne Mbarga", estimatedHours: 1.5, actualHours: null, status: "pending" },
  ],
  parts: [{ reference: "FLT-001", name: "Filtre à huile", quantity: 2 }],
  generatedAt: new Date("2026-11-02T10:00:00Z"),
  generatedByName: "Admin",
};

async function xmlOf(doc: "ot" | "bon-sortie", data = base): Promise<string> {
  const buf = await buildWorkOrderDocx(doc, data);
  const files = unzipSync(new Uint8Array(buf));
  expect(files["word/document.xml"]).toBeDefined();
  return strFromU8(files["word/document.xml"]);
}

describe("generateur docx de l'ordre de travail", () => {
  it("produit un zip docx valide", async () => {
    const buf = await buildWorkOrderDocx("ot", base);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
  });

  it("l'OT contient en-tete TAY, vehicule, travaux, pieces, signatures, accents", async () => {
    const xml = await xmlOf("ot");
    for (const t of [
      "Ordre de travail n° 62",
      "LT-123-AB",
      "Renault Master",
      "Vidange moteur",
      "FLT-001",
      "Filtre à huile",
      "Étienne Mbarga",
      "Signatures",
      "02/11/2026",
    ]) {
      expect(xml).toContain(t);
    }
    expect(xml).not.toContain("undefined");
    expect(xml).not.toContain("null");
    expect(xml).toContain("<w:tbl>");
  });

  it("le bon de sortie liste les pieces et deux signatures", async () => {
    const xml = await xmlOf("bon-sortie");
    for (const t of ["Bon de sortie", "FLT-001", "Magasinier", "Technicien (réception)"]) expect(xml).toContain(t);
    expect(xml).not.toContain("Chef d");
  });

  it("0 piece : message explicite", async () => {
    const ot = await xmlOf("ot", { ...base, parts: [], lines: [] });
    expect(ot).toContain("Aucune pièce.");
    expect(ot).toContain("Aucune ligne de travail.");
    const bs = await xmlOf("bon-sortie", { ...base, parts: [] });
    expect(bs).toContain("Aucune pièce à sortir.");
  });

  it("champs absents : tiret, jamais undefined", async () => {
    const xml = await xmlOf("ot", {
      ...base,
      technicianName: undefined,
      vehicle: {},
      description: undefined,
      generatedByName: undefined,
    });
    expect(xml).not.toContain("undefined");
    expect(xml).toContain("Aucune description.");
  });

  it("texte long et caracteres XML echappes", async () => {
    const long = "A & B <x> ".repeat(2000);
    const xml = await xmlOf("ot", { ...base, description: long });
    expect(xml).toContain("A &amp; B &lt;x&gt;");
  });

  it("nom de fichier", () => {
    expect(workOrderDocFilename("ot", 62)).toBe("ordre-travail-62.docx");
    expect(workOrderDocFilename("bon-sortie", 62)).toBe("bon-sortie-62.docx");
  });
});

describe("en-tete officiel TAY", () => {
  it("l'image est dans word/media et reliee depuis l'en-tete", async () => {
    const files = unzipSync(new Uint8Array(await buildWorkOrderDocx("ot", base)));
    expect(Object.keys(files).some((f) => f.startsWith("word/media/"))).toBe(true);
    const headerName = Object.keys(files).find((f) => /^word\/header\d*\.xml$/.test(f))!;
    expect(headerName).toBeDefined();
    expect(strFromU8(files[headerName])).toContain("<w:drawing>");
    const rels = strFromU8(files[headerName.replace("word/", "word/_rels/") + ".rels"]);
    expect(rels).toMatch(/relationships\/image/);
    expect(rels).toContain("media/");
    // le texte de repli n'est pas duplique dans le corps
    expect(strFromU8(files["word/document.xml"])).not.toContain("Gestion de flotte");
  });

  it("image absente : repli texte, sans entete image", async () => {
    const files = unzipSync(new Uint8Array(await buildWorkOrderDocx("bon-sortie", base, { companyName: "TAY", tagline: "Gestion de flotte et maintenance", logo: null })));
    expect(Object.keys(files).some((f) => f.startsWith("word/media/"))).toBe(false);
    const xml = strFromU8(files["word/document.xml"]);
    expect(xml).toContain("TAY");
    expect(xml).toContain("Gestion de flotte et maintenance");
  });
});
