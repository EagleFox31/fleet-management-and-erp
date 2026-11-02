import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : xlsx reste sur l'archive SheetJS CE 0.20.3 versionnée dans le dépôt.
 * La 0.18.5 de npm est vulnérable (CVE-2023-30533, CVE-2024-22363) et sans correctif.
 */
const root = resolve(__dirname, "../../..");
const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

describe("dépendance xlsx", () => {
  it("package.json pointe l'archive du dépôt", () => {
    expect(pkg.dependencies.xlsx).toBe("file:vendor/xlsx-0.20.3.tgz");
  });

  it("package-lock.json résout vers l'archive avec une integrity sha512", () => {
    const entry = lock.packages["node_modules/xlsx"];
    expect(entry.resolved).toBe("file:vendor/xlsx-0.20.3.tgz");
    expect(entry.version).toBe("0.20.3");
    expect(entry.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
    expect(lock.packages[""].dependencies.xlsx).toBe("file:vendor/xlsx-0.20.3.tgz");
  });

  it("l'archive est présente dans le dépôt", () => {
    expect(existsSync(resolve(root, "vendor/xlsx-0.20.3.tgz"))).toBe(true);
  });

  it("l'integrity du lockfile est le sha512 réel de l'archive", () => {
    const archive = readFileSync(resolve(root, "vendor/xlsx-0.20.3.tgz"));
    const digest = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
    expect(lock.packages["node_modules/xlsx"].integrity).toBe(digest);
  });
});
