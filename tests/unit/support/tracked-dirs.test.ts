import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTrackedDir, trackDir } from "../../support/tracked-dirs";

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("ménage d'un dossier suivi par un test", () => {
  it("dossier existant (versionné) : seul ce que le test a créé disparaît, le .gitkeep reste", () => {
    root = mkdtempSync(join(tmpdir(), "tracked-"));
    const dir = join(root, "vehicle-1");
    mkdirSync(dir);
    writeFileSync(join(dir, ".gitkeep"), "");

    const tracked = trackDir(dir);
    writeFileSync(join(dir, "carte-grise.pdf"), "x");
    mkdirSync(join(dir, "sous-dossier"));
    cleanupTrackedDir(tracked);

    expect(existsSync(join(dir, ".gitkeep"))).toBe(true);
    expect(existsSync(join(dir, "carte-grise.pdf"))).toBe(false);
    expect(existsSync(join(dir, "sous-dossier"))).toBe(false);
  });

  it("dossier créé par le test : supprimé en entier", () => {
    root = mkdtempSync(join(tmpdir(), "tracked-"));
    const dir = join(root, "vehicle-999");
    const tracked = trackDir(dir);
    mkdirSync(dir);
    writeFileSync(join(dir, "doc.pdf"), "x");
    cleanupTrackedDir(tracked);
    expect(existsSync(dir)).toBe(false);
  });

  it("dossier jamais créé : aucun effet, aucune erreur", () => {
    root = mkdtempSync(join(tmpdir(), "tracked-"));
    expect(() => cleanupTrackedDir(trackDir(join(root, "absent")))).not.toThrow();
  });
});
