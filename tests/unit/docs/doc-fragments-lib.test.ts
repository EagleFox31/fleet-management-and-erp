import { describe, expect, it } from "vitest";
import {
  FRAGMENT_NAME,
  fragmentName,
  renderIndex,
  slugify,
  splitSections,
  stampFromDate,
  stampFromHeading,
} from "../../../scripts/lib/doc-fragments";

describe("doc-fragments : découpe", () => {
  it("recolle préambule et sections en texte d'origine, CRLF ramené à LF", () => {
    const src = "# T\r\n\r\nintro\r\n\r\n## a\r\nx\r\n---\r\n## b\r\ny\r\n";
    const { preamble, sections } = splitSections(src);
    expect(preamble).toBe("# T\n\nintro\n\n");
    expect(sections.map((s) => s.heading)).toEqual(["a", "b"]);
    expect(preamble + sections.map((s) => s.text).join("")).toBe(src.replace(/\r\n/g, "\n"));
    expect(sections[1].line).toBe(8);
  });

  it("ignore un `## ` dans un bloc de code", () => {
    const { sections } = splitSections("## a\n```\n## pas un titre\n```\n## b\n");
    expect(sections.map((s) => s.heading)).toEqual(["a", "b"]);
  });

  it("fichier sans section : tout est préambule", () => {
    expect(splitSections("rien\n")).toEqual({ preamble: "rien\n", sections: [] });
  });
});

describe("doc-fragments : nommage", () => {
  it("lit l'horodatage des deux formats de titre", () => {
    expect(stampFromHeading("2026-11-09T15:26:00+01:00 — Rendu")).toBe("2026-11-09T1526");
    expect(stampFromHeading("2026-11-05 14:30 — Lot")).toBe("2026-11-05T1430");
    expect(stampFromHeading("6237cb3 - Matrice RBAC")).toBeNull();
  });

  it("horodatage de repli en heure de Douala (UTC+1)", () => {
    expect(stampFromDate(new Date("2026-11-09T23:30:00Z"))).toBe("2026-11-10T0030");
  });

  it("slug ASCII sans date, sha ni numéro de PR, borné à 60", () => {
    expect(slugify("6237cb3 - Matrice RBAC et ratchet des schémas d'insertion")).toBe(
      "matrice-rbac-et-ratchet-des-schemas-d-insertion",
    );
    expect(slugify("2026-11-09T15:37:39+01:00 — Alertes : `/api/alerts` (#613)")).toBe("alertes-api-alerts");
    expect(slugify("Lot 1a2b3c4 5d6e7f8 - Stock")).toBe("lot-stock");
    expect(slugify("x".repeat(80)).length).toBeLessThanOrEqual(60);
    expect(slugify("2026-11-09")).toBe("entree");
  });

  it("nom unique et conforme, suffixe en cas de collision", () => {
    const taken = new Set<string>();
    const a = fragmentName("2026-11-09T1526", "Rendu", taken);
    const b = fragmentName("2026-11-09T1526", "Rendu", taken);
    expect([a, b]).toEqual(["2026-11-09T1526-rendu.md", "2026-11-09T1526-rendu-2.md"]);
    expect(FRAGMENT_NAME.test(a) && FRAGMENT_NAME.test(b)).toBe(true);
  });

  it("index trié par nom, barres verticales échappées", () => {
    const out = renderIndex([
      { name: "2026-11-09T1600-b.md", heading: "B | c" },
      { name: "2026-11-01T0900-a.md", heading: "A" },
    ]);
    expect(out.split("\n").slice(2)).toEqual([
      "| 2026-11-01T0900 | [A](2026-11-01T0900-a.md) |",
      "| 2026-11-09T1600 | [B \\| c](2026-11-09T1600-b.md) |",
    ]);
  });
});
