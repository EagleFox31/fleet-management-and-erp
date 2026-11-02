import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeCenterName } from "@shared/contracts/document-renewal-centers";

const apiDir = path.resolve(__dirname, "../../../server/api");
const apiFiles = readdirSync(apiDir).filter((file) => file.endsWith(".ts"));

describe("DOC1 : résolution des centres par égalité, jamais par motif", () => {
  it("aucun routeur n'appelle ilike(documentRenewalCenters.name ...) : % _ et \\ seraient des jokers", () => {
    const offenders = apiFiles.filter((file) => /ilike\(\s*documentRenewalCenters\.name/.test(readFileSync(path.join(apiDir, file), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("les deux routes de demande passent par le même résolveur", () => {
    const source = readFileSync(path.join(apiDir, "document-renewals.routes.ts"), "utf8");
    expect(source.match(/resolveRenewalCenter\(/g)).toHaveLength(2);
    expect(source).not.toMatch(/insert\(documentRenewalCenters\)/);
  });

  it("normalise casse, bords et espaces répétés, sans toucher aux jokers", () => {
    expect(normalizeCenterName("  Centre   AGRÉÉ  Douala ")).toBe("centre agréé douala");
    expect(normalizeCenterName("100%_\\")).toBe("100%_\\");
  });
});
