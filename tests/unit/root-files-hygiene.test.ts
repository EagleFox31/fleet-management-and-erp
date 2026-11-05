import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Fichiers suivis à la racine du dépôt : liste fermée. Le 5 novembre 2026, un fichier `0` a été
 * commité à la racine (#519). Il venait d'une redirection de shell pendant des mutants. Un nouveau fichier racine
 * se déclare ici, en connaissance de cause ; sinon il va dans un dossier.
 */
const ALLOWED_ROOT_FILES = [
  ".dockerignore",
  ".env.example",
  ".gitattributes",
  ".gitignore",
  ".replit",
  "AGENTS.md",
  "Dockerfile",
  "PASSATION-CDC.md",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "capacitor.config.ts",
  "components.json",
  "docker-compose.test.yml",
  "drizzle.config.ts",
  "generated-icon.png",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "postcss.config.js",
  "tailwind.config.ts",
  // Scripts historiques : à déplacer ou supprimer, la liste ne fait que rétrécir.
  "test-sprint1-services.js",
  "test-status-history.js",
  "test-workflow-reminders.js",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  "vitest.contract.config.ts",
  "vitest.integration.config.ts",
];

function trackedRootFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return out.split("\0").filter((path) => path && !path.includes("/"));
}

describe("fichiers suivis à la racine", () => {
  const tracked = trackedRootFiles();

  it("aucun fichier racine hors liste (redirection de shell, sortie de commande, brouillon)", () => {
    expect(tracked.filter((file) => !ALLOWED_ROOT_FILES.includes(file))).toEqual([]);
  });

  it("cliquet : un fichier retiré du dépôt sort de la liste", () => {
    expect(ALLOWED_ROOT_FILES.filter((file) => !tracked.includes(file))).toEqual([]);
  });
});
