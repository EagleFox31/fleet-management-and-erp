import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Le bouton de restauration écrit toute la base : envoi protégé contre le double clic (AGENTS §10). */
describe("import-backup : envoi unique", () => {
  const page = readFileSync("client/src/pages/admin/import-backup.tsx", "utf8");

  it("passe par useSingleFlightMutate, jamais par importMutation.mutate() direct", () => {
    expect(page).toMatch(/useSingleFlightMutate\(importMutation\.mutate\)/);
    expect(page).not.toMatch(/importMutation\.mutate\(\)/);
  });
});
