import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Vitest écrit ses snapshots en LF. Sous Windows avec `core.autocrlf=true`, un `.snap` sorti en CRLF
 * était réécrit à chaque passe de tests : `git status` montrait un fichier modifié sans différence
 * de contenu (10 novembre 2026, `offline-read-driver.test.ts.snap`). `eol=lf` dans .gitattributes
 * fixe la fin de ligne au checkout, quel que soit le poste.
 *
 * Complément en CI : l'arbre doit rester propre après `npm test` (`.github/workflows/ci.yml`).
 */
function eolAttr(path: string): string {
  const out = execFileSync("git", ["check-attr", "eol", "--", path], { encoding: "utf8" });
  return out.trim().split(": ").pop() ?? "";
}

describe(".gitattributes : snapshots Vitest en LF", () => {
  it("chaque snapshot suivi est sorti en LF", () => {
    const snaps = execFileSync("git", ["ls-files", "--", "*.snap"], { encoding: "utf8" }).split("\n").filter(Boolean);
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps.filter((p) => eolAttr(p) !== "lf")).toEqual([]);
  });

  it("un futur snapshot, n'importe où, l'est aussi", () => {
    expect(eolAttr("tests/contract/__snapshots__/nouveau.contract.test.ts.snap")).toBe("lf");
    expect(eolAttr("tests/unit/server/deep/__snapshots__/x.test.ts.snap")).toBe("lf");
  });
});
