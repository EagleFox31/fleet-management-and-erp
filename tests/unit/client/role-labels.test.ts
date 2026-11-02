import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";
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

const CLIENT_SRC = join(__dirname, "../../../client/src");
const SOURCE_OF_TRUTH = "lib/contextual-help/roles.ts";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

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

  it("aucun écran ne redéclare sa table de libellés de rôle", () => {
    const offenders = sourceFiles(CLIENT_SRC)
      .filter((file) => relative(CLIENT_SRC, file).replace(/\\/g, "/") !== SOURCE_OF_TRUTH)
      .filter((file) => /\b(const|function|let)\s+getRoleLabel\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(CLIENT_SRC, file).replace(/\\/g, "/"));
    expect(offenders).toEqual([]);
  });
});
