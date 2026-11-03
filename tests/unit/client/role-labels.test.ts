import { describe, expect, it } from "vitest";
import { readRepoFiles, REPO_SCAN_TIMEOUT_MS, repoFiles } from "../../support/repo-files";
import { ALL_APP_ROLES } from "../../../shared/constants/roles";
import { getRoleLabel, normalizeRole } from "../../../client/src/lib/contextual-help/roles";
import { APP_ROLES } from "../../../client/src/lib/contextual-help/types";

/**
 * Libellés de rôle : une seule table côté client.
 *
 * Quatre écrans redéclaraient leur `getRoleLabel` local. Celui de la liste des
 * utilisateurs ne connaissait que 5 rôles : un magasinier, un logisticien ou
 * un membre de la direction y apparaissait « Utilisateur ».
 */

const SOURCE_OF_TRUTH = "client/src/lib/contextual-help/roles.ts";

describe("libellés de rôle", () => {
  it("la liste client des rôles suit le schéma", () => {
    expect([...APP_ROLES].sort()).toEqual([...ALL_APP_ROLES].sort());
  });

  it("chaque rôle du schéma a son propre libellé", () => {
    for (const role of ALL_APP_ROLES) {
      const label = getRoleLabel(normalizeRole(role));
      if (role !== "user") expect(label, role).not.toBe("Utilisateur");
    }
    const labels = ALL_APP_ROLES.map((role) => getRoleLabel(role));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("aucun écran ne redéclare sa table de libellés de rôle", async () => {
    const files = repoFiles({ under: ["client/src"], match: /\.tsx?$/ }).filter((f) => f !== SOURCE_OF_TRUTH);
    expect(files.length).toBeGreaterThan(100);
    const offenders = (await readRepoFiles(files))
      .filter(([, text]) => /\b(const|function|let)\s+getRoleLabel\b/.test(text))
      .map(([file]) => file.replace(/^client\/src\//, ""));
    expect(offenders).toEqual([]);
  }, REPO_SCAN_TIMEOUT_MS);
});
