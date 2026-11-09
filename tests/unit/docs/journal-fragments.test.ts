import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FRAGMENT_NAME, toLf } from "../../../scripts/lib/doc-fragments";

// Garde du journal en fragments. Leçon : docs/analysis/LESSONS_LEARNED.md, 2026-11-09,
// « Journal à fichier unique : un conflit à chaque fusion ».
const ROOT = path.resolve(__dirname, "../../..");
const LEGACY = path.join(ROOT, "docs/qa/JOURNAL_COUVERTURE.md");
const DIR = path.join(ROOT, "docs/qa/journal");
const MANIFEST = path.join(DIR, "_migration-2026-11-09.json");
const CONSIGNE =
  "Écris ton entrée dans docs/qa/journal/<AAAA-MM-JJTHHMM>-<slug>.md (première ligne « ## <sujet> »), voir docs/qa/journal/README.md";

const read = (p: string) => toLf(readFileSync(p, "utf8"));

describe("journal de couverture en fragments", () => {
  it("l'ancien fichier unique ne reçoit plus d'entrée", () => {
    const entries = read(LEGACY)
      .split("\n")
      .filter((l) => l.startsWith("## "));
    expect(entries, CONSIGNE).toEqual([]);
  });

  it("chaque fichier du dossier est un fragment bien nommé qui commence par `## `", () => {
    const fautifs = readdirSync(DIR)
      .filter((n) => n !== "README.md" && n !== path.basename(MANIFEST))
      .filter((n) => !FRAGMENT_NAME.test(n) || !read(path.join(DIR, n)).startsWith("## "));
    expect(fautifs, CONSIGNE).toEqual([]);
  });

  it("la migration n'a rien perdu : préambule + fragments recollés = empreinte d'origine", () => {
    expect(existsSync(MANIFEST), "manifeste de migration absent").toBe(true);
    const m = JSON.parse(readFileSync(MANIFEST, "utf8")) as { sha256: string; preamble: string; fragments: string[] };
    expect(m.fragments.length).toBeGreaterThan(0);
    const manquants = m.fragments.filter((f) => !existsSync(path.join(DIR, f)));
    expect(manquants, "fragment migré supprimé ou renommé : le manifeste est figé").toEqual([]);
    const recolle = m.preamble + m.fragments.map((f) => read(path.join(DIR, f))).join("");
    expect(
      createHash("sha256").update(recolle).digest("hex"),
      "fragment migré modifié : une correction est une nouvelle entrée",
    ).toBe(m.sha256);
  });
});
