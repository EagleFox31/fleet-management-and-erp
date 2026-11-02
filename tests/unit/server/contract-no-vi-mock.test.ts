import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Aucun `vi.mock` / `vi.doMock` dans tests/contract.
 *
 * vitest.contract.config.ts tourne avec `isolate: false` et un seul worker (choix
 * volontaire : une instance d'app et un pool par processus). Le cache de modules est
 * partagé entre fichiers : si un fichier précédent du shard a déjà chargé le module,
 * le mock ne s'applique pas. Le test passe ou échoue selon la répartition des shards
 * (incident CI de #117 sur document-renewal-centers, 201 au lieu de 409).
 *
 * Pour simuler une panne dans un contrat : la provoquer en base (trigger temporaire,
 * contrainte), ou injecter la dépendance dans le service.
 */
const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const contractDir = join(root, "tests/contract");
const FORBIDDEN = /\bvi\s*\.\s*(mock|doMock)\s*\(/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [full] : [];
  });
}

describe("hygiène des tests de contrat", () => {
  it("aucun vi.mock / vi.doMock (inopérant avec isolate:false)", () => {
    const offenders = walk(contractDir).flatMap((file) =>
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => FORBIDDEN.test(line) && !/^\s*(\/\/|\*)/.test(line))
        .map(({ n }) => `${relative(root, file).replace(/\\/g, "/")}:${n}`),
    );
    expect(offenders).toEqual([]);
  });
});
