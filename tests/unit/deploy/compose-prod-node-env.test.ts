import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// #264 : les services qui touchent la base de production et tournent sur la cible `build` (x-tools,
// sans `ENV NODE_ENV=production`) doivent fixer NODE_ENV=production. Sinon le garde base de production
// (server/lib/production-db-guard.ts) s'appliquerait à eux, et ajouter l'hôte de prod à
// E2E_PRODUCTION_DB_MARKERS bloquerait le déploiement.
const compose = readFileSync(path.resolve(__dirname, "../../../deploy/docker-compose.yml"), "utf-8");

/** Bloc d'un service : de `  <nom>:` jusqu'au service suivant (indentation de 2 espaces). */
export function serviceBlock(content: string, name: string): string | null {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^ {0,2}\S/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

/** Services sur x-tools (`<<: *tools`) dont l'env vise la production. */
function prodToolServices(content: string): string[] {
  return [...content.matchAll(/^ {2}([a-z0-9-]+):$/gm)]
    .map((m) => m[1])
    .filter((name) => {
      const block = serviceBlock(content, name) ?? "";
      return /<<: \*tools/.test(block) && /\.env\.prod|db-prod/.test(block);
    });
}

describe("Compose : outils de production en NODE_ENV=production", () => {
  it("schema-prod est bien un outil de production", () => {
    expect(prodToolServices(compose)).toContain("schema-prod");
  });

  it.each(prodToolServices(compose))("%s fixe NODE_ENV: production", (name) => {
    expect(serviceBlock(compose, name)).toMatch(/^\s+NODE_ENV: production\s*$/m);
  });

  it("le découpage s'arrête au service suivant", () => {
    const yml = "services:\n  a:\n    <<: *tools\n    env_file: .env.prod\n  b:\n    environment:\n      NODE_ENV: production\n";
    expect(serviceBlock(yml, "a")).not.toMatch(/NODE_ENV/);
    expect(prodToolServices(yml)).toEqual(["a"]);
  });
});
