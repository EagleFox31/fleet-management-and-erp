import { describe, expect, it } from "vitest";
import { readRepoFiles, REPO_SCAN_TIMEOUT_MS, repoFiles } from "../support/repo-files";

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


describe("hygiène du dépôt", () => {
  it("aucun marqueur de conflit dans les fichiers suivis", async () => {
    const files = repoFiles().filter((f) => EXTENSIONS.some((ext) => f.endsWith(ext)));
    expect(files.length).toBeGreaterThan(100);
    const offenders = (await readRepoFiles(files.filter((f) => !KNOWN_MARKER_FILES.includes(f))))
      .filter(([, text]) => MARKER.test(text))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  }, REPO_SCAN_TIMEOUT_MS);

  it("le motif reconnaît les trois marqueurs, et eux seuls", () => {
    expect(MARKER.test("a\n<<<<<<< HEAD\nb")).toBe(true);
    expect(MARKER.test("a\n=======\r\nb")).toBe(true);
    expect(MARKER.test("a\n>>>>>>> origin/main\nb")).toBe(true);
    expect(MARKER.test("titre\n=======\nsuite")).toBe(true);
    expect(MARKER.test("a ======= b\n========\n<<<<<<<<")).toBe(false);
  });
});
