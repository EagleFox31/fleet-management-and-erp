import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Erreur répétée du 4 novembre 2026 (LESSONS_LEARNED) : chaque fusion mettait les autres PR en
 * conflit sur les fichiers tenus en ajout de fin (LESSONS, journaux, passations). `merge=union`
 * dans .gitattributes fait garder les deux entrées au merge local.
 */
const UNION = [
  "docs/analysis/LESSONS_LEARNED.md",
  "docs/journal/c7-deploiement.md",
  "docs/journal/nouveau-chantier.md",
  "PASSATION-CDC.md",
  "PASSATION.md",
];

function mergeAttr(path: string, cwd = process.cwd()): string {
  const out = execFileSync("git", ["check-attr", "merge", "--", path], { cwd, encoding: "utf8" });
  return out.trim().split(": ").pop() ?? "";
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe(".gitattributes : fusion union des fichiers en ajout de fin", () => {
  it.each(UNION)("%s fusionne en union", (path) => {
    expect(mergeAttr(path)).toBe("union");
  });

  it("le README du journal, réécrit à la main, garde la fusion normale", () => {
    expect(mergeAttr("docs/journal/README.md")).not.toBe("union");
  });

  it("deux branches qui ajoutent chacune une entrée en fin de LESSONS fusionnent sans conflit et gardent les deux", () => {
    const dir = mkdtempSync(join(tmpdir(), "union-"));
    try {
      git(dir, "init", "-q", "-b", "main");
      copyFileSync(".gitattributes", join(dir, ".gitattributes"));
      const file = join(dir, "docs", "analysis", "LESSONS_LEARNED.md");
      mkdirSync(join(dir, "docs", "analysis"), { recursive: true });
      writeFileSync(file, "# Leçons\n\n## Entrée existante\n");
      git(dir, "add", ".");
      git(dir, "commit", "-qm", "base");
      git(dir, "checkout", "-qb", "a");
      writeFileSync(file, readFileSync(file, "utf8") + "\n## Entrée A\n- fait A\n");
      git(dir, "commit", "-qam", "A");
      git(dir, "checkout", "-q", "main");
      git(dir, "checkout", "-qb", "b");
      writeFileSync(file, readFileSync(file, "utf8") + "\n## Entrée B\n- fait B\n");
      git(dir, "commit", "-qam", "B");
      git(dir, "merge", "-q", "--no-edit", "a");
      const merged = readFileSync(file, "utf8");
      expect(merged).toContain("## Entrée existante");
      expect(merged).toContain("## Entrée A");
      expect(merged).toContain("## Entrée B");
      expect(merged).not.toMatch(/^(<{7}|={7}|>{7})/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
