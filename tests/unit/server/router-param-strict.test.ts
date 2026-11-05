import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * Une garde refuse ce qu'elle ne sait pas lire : un router.param qui fait `return next()` sur une valeur
 * invalide laisse la requête atteindre un handler qui relit le paramètre autrement (parseInt tolère un suffixe).
 */
const API_DIR = join(process.cwd(), "server", "api");

function paramBlocks(source: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf("router.param(", from);
    if (start === -1) return blocks;
    const end = source.indexOf("\n});", start);
    blocks.push(source.slice(start, end === -1 ? undefined : end));
    from = start + 1;
  }
}

describe("router.param", () => {
  const files = readdirSync(API_DIR).filter((f) => f.endsWith(".ts"));

  it("aucun router.param ne laisse passer sans contrôle une valeur invalide (`return next()` nu)", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const block of paramBlocks(readFileSync(join(API_DIR, file), "utf8"))) {
        if (/\breturn\s+next\(\)/.test(block)) offenders.push(`${file} : ${block.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("la garde de missions existe (le test ci-dessus ne passe pas à vide)", () => {
    const blocks = paramBlocks(readFileSync(join(API_DIR, "missions.routes.ts"), "utf8"));
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.join("\n")).toContain("parseMissionId");
  });
});
