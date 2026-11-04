import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Un repli `${X_PASSWORD:-valeur}` met un mot de passe public dans le dépôt : un serveur lancé sans
// .env tourne alors avec un compte connu de tous (audit #247). Seul le repli vide `${X:-}` est permis :
// Postgres refuse un mot de passe vide et le seed exige 12 caractères. `${X:?}` n'est pas utilisable,
// car Compose interpole tous les services, y compris ceux des profils inactifs.
const root = path.resolve(__dirname, "../../..");
const composeFiles = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf-8" })
  .split(/\r?\n/)
  .filter((file) => /(^|\/)(docker-)?compose[^/]*\.ya?ml$/i.test(file));

/** Variables sensibles déclarées avec une valeur de repli non vide. */
export function sensitiveDefaults(content: string): string[] {
  const found: string[] = [];
  for (const match of content.matchAll(/\$\{([A-Z0-9_]*(?:PASSWORD|SECRET)[A-Z0-9_]*):?-([^}]*)\}/g)) {
    if (match[2] !== "") found.push(match[0]);
  }
  return found;
}

describe("Compose : aucun mot de passe ni secret par défaut", () => {
  it("trouve les fichiers compose du dépôt", () => {
    expect(composeFiles).toContain("deploy/docker-compose.yml");
  });

  it.each(composeFiles)("%s : aucun repli non vide sur *PASSWORD* / *SECRET*", (file) => {
    expect(sensitiveDefaults(readFileSync(path.join(root, file), "utf-8"))).toEqual([]);
  });

  it("le garde détecte un repli public et accepte le repli vide", () => {
    expect(sensitiveDefaults("a: ${SITE_DB_PASSWORD:-fleet-site}\nb: ${SESSION_SECRET-x}")).toHaveLength(2);
    expect(sensitiveDefaults("a: ${SITE_DB_PASSWORD:-}\nb: ${APP_URL:-http://localhost}")).toEqual([]);
  });
});
