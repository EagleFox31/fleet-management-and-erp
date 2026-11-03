import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou issu de #130 (LESSONS_LEARNED, 3 novembre 2026) : la route validait
 * `parseInt(req.params.vehicleId)`, la destination multer employait la chaîne brute
 * pour construire le dossier, et `1../../x` sortait de `uploads/`.
 *
 * Dans les options d'un `multer.diskStorage`, une valeur de requête ne s'emploie
 * que sur une ligne qui la passe à un validateur de segment de chemin.
 */
const PATH_VALIDATORS = ["vehicleDocumentDirectory(", "isSafePathSegment(", "isVehicleIdSegment("];

const serverDir = fileURLToPath(new URL("../../../server", import.meta.url));

function serverSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverSources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** Texte des options passées à `diskStorage(`, par appariement des parenthèses. */
function diskStorageBlocks(source: string): string[] {
  const blocks: string[] = [];
  for (const match of source.matchAll(/diskStorage\s*\(/g)) {
    let depth = 0;
    const start = match.index! + match[0].length - 1;
    for (let i = start; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) {
        blocks.push(source.slice(start, i + 1));
        break;
      }
    }
  }
  return blocks;
}

describe("hygiène des stockages multer", () => {
  const files = serverSources(serverDir).filter((file) => readFileSync(file, "utf8").includes("diskStorage"));

  it("le balayage trouve les stockages disque connus", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it("aucune valeur de requête n'atteint destination ou filename sans validateur", () => {
    const offenders = files.flatMap((file) =>
      diskStorageBlocks(readFileSync(file, "utf8")).flatMap((block) =>
        block
          .split("\n")
          .filter((line) => /req\.(params|body|query|headers)\b/.test(line))
          .filter((line) => !PATH_VALIDATORS.some((validator) => line.includes(validator)))
          .map((line) => `${relative(serverDir, file)} : ${line.trim()}`),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
