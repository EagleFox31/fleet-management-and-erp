import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareToBaseline, countErrorsByFile, lowerBaseline } from "../../../scripts/lib/tests-typecheck-ratchet.mjs";

const OUTPUT = [
  "tests/unit/a.test.ts(3,5): error TS2339: Property 'x' does not exist.",
  "tests\\unit\\a.test.ts(9,1): error TS2322: Type 'string' is not assignable.",
  "  suite de message sur plusieurs lignes",
  "e2e/b.spec.ts(1,1): error TS2345: Argument mismatch.",
].join("\r\n");

describe("cliquet du typecheck des tests", () => {
  it("compte les erreurs par fichier, chemins Windows normalisés", () => {
    expect(countErrorsByFile(OUTPUT)).toEqual({ "tests/unit/a.test.ts": 2, "e2e/b.spec.ts": 1 });
    expect(countErrorsByFile("")).toEqual({});
  });

  it("échoue sur un fichier hors base ou au-delà de son compte figé", () => {
    const { regressions } = compareToBaseline(
      { "tests/a.ts": 3, "tests/new.ts": 1, "tests/ok.ts": 2 },
      { "tests/a.ts": 2, "tests/ok.ts": 2 },
    );
    expect(regressions).toEqual([
      { file: "tests/a.ts", count: 3, allowed: 2 },
      { file: "tests/new.ts", count: 1, allowed: 0 },
    ]);
  });

  it("signale une base à abaisser, sans régression", () => {
    const result = compareToBaseline({ "tests/a.ts": 1 }, { "tests/a.ts": 2, "tests/fixed.ts": 4 });
    expect(result.regressions).toEqual([]);
    expect(result.improvements).toEqual([
      { file: "tests/a.ts", count: 1, allowed: 2 },
      { file: "tests/fixed.ts", count: 0, allowed: 4 },
    ]);
  });

  it("la base ne fait que baisser, et une seconde mise à jour ne change rien", () => {
    const baseline = { "tests/a.ts": 2, "tests/fixed.ts": 4 };
    const lowered = lowerBaseline({ "tests/a.ts": 1, "tests/new.ts": 5 }, baseline);
    expect(lowered).toEqual({ "tests/a.ts": 1 });
    expect(lowerBaseline({ "tests/a.ts": 1 }, lowered)).toEqual(lowered);
  });

  it("la base versionnée ne vise que tests/ et e2e/, avec des comptes positifs", () => {
    const baseline: Record<string, number> = JSON.parse(readFileSync("tests/typecheck-baseline.json", "utf8"));
    for (const [file, count] of Object.entries(baseline)) {
      expect(file).toMatch(/^(tests|e2e)\//);
      expect(count).toBeGreaterThan(0);
    }
  });
});
