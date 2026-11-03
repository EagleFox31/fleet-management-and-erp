import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou issu d'un near miss (LESSONS_LEARNED, 3 novembre 2026, #142) : une
 * fusion a été poussée avec des marqueurs de conflit. Le job `typecheck` les
 * attrape dans un `.ts` / `.tsx`, rien ne les attrapait dans un `.md`, un `.sql`
 * ou un `.yml`. Ce test couvre tous les fichiers suivis de ces extensions.
 *
 * Liste gelée : fichiers où une ligne de marqueur serait légitime. Vide au
 * 3 novembre 2026 (aucune occurrence sur `main`). Toute entrée se justifie ici.
 */
const KNOWN_MARKER_FILES: string[] = [];

const EXTENSIONS = [".md", ".sql", ".yml", ".yaml", ".json", ".ts", ".tsx"];
const MARKER = /^(<{7} |>{7} |={7}\r?$)/m;

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter((f) => EXTENSIONS.some((ext) => f.endsWith(ext)));
}

describe("hygiène du dépôt", () => {
  it("aucun marqueur de conflit dans les fichiers suivis", () => {
    const files = trackedFiles();
    expect(files.length).toBeGreaterThan(100);
    const offenders = files
      .filter((f) => !KNOWN_MARKER_FILES.includes(f))
      .filter((f) => {
        try {
          return MARKER.test(readFileSync(join(repoRoot, f), "utf8"));
        } catch {
          return false; // suivi mais absent de l'arbre de travail (suppression non commitée)
        }
      });
    expect(offenders).toEqual([]);
  });

  it("le motif reconnaît les trois marqueurs, et eux seuls", () => {
    expect(MARKER.test("a\n<<<<<<< HEAD\nb")).toBe(true);
    expect(MARKER.test("a\n=======\r\nb")).toBe(true);
    expect(MARKER.test("a\n>>>>>>> origin/main\nb")).toBe(true);
    expect(MARKER.test("titre\n=======\nsuite")).toBe(true);
    expect(MARKER.test("a ======= b\n========\n<<<<<<<<")).toBe(false);
  });
});
