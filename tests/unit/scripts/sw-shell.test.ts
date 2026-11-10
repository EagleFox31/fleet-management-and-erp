import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildShellManifest, injectShellManifest, shellAssetUrls } from "../../../scripts/lib/sw-shell";

const BUNDLE = [
  "index.html",
  "assets/index-CUqDG9ME.js",
  "assets/index-B9xbx-6d.css",
  "assets/index-CUqDG9ME.js.map",
  "assets/Plus-Jakarta-aaa.woff2",
  "assets/logo-123.png",
  "assets/readme-1.txt",
  "sw.js",
];

describe("précache de la coquille : liste des assets du build", () => {
  it("garde le code, les styles, les polices et les images de assets/, triés, en URL absolues", () => {
    expect(shellAssetUrls(BUNDLE)).toEqual([
      "/assets/Plus-Jakarta-aaa.woff2",
      "/assets/index-B9xbx-6d.css",
      "/assets/index-CUqDG9ME.js",
      "/assets/logo-123.png",
    ]);
  });

  it("exclut cartes de sources, HTML et fichiers hors assets/", () => {
    const urls = shellAssetUrls(BUNDLE);
    expect(urls.some((u) => u.endsWith(".map") || u.endsWith(".html") || u.includes("sw.js"))).toBe(false);
  });
});

describe("précache de la coquille : empreinte du build", () => {
  const html = "<html>index</html>";
  it("est stable pour un même build, quel que soit l'ordre du bundle", () => {
    expect(buildShellManifest(BUNDLE, html).build).toBe(buildShellManifest([...BUNDLE].reverse(), html).build);
  });
  it("change si un asset change de nom (contenu modifié)", () => {
    const changed = BUNDLE.map((n) => n.replace("CUqDG9ME", "ZZZZZZZZ"));
    expect(buildShellManifest(changed, html).build).not.toBe(buildShellManifest(BUNDLE, html).build);
  });
  it("change si l'index.html change", () => {
    expect(buildShellManifest(BUNDLE, "<html>autre</html>").build).not.toBe(buildShellManifest(BUNDLE, html).build);
  });
  it("tient dans un nom de cache : 10 caractères hexadécimaux", () => {
    expect(buildShellManifest(BUNDLE, html).build).toMatch(/^[0-9a-f]{10}$/);
  });
});

describe("précache de la coquille : injection dans sw.js", () => {
  const source = readFileSync(path.resolve("client/public/sw.js"), "utf8");

  it("le vrai sw.js porte le marqueur, et le remplacement donne un JavaScript valide", () => {
    const manifest = buildShellManifest(BUNDLE, "x");
    const injected = injectShellManifest(source, manifest);
    expect(injected).not.toContain("/*SHELL_MANIFEST*/");
    expect(injected).toContain(`"build":"${manifest.build}"`);
    expect(() => new Function(injected)).not.toThrow();
  });

  it("refuse un sw.js sans marqueur (précache silencieusement absent)", () => {
    expect(() => injectShellManifest("const x = 1;", { build: "a", assets: [] })).toThrow(/SHELL_MANIFEST/);
  });

  it("ne réinterprète pas les motifs `$` du JSON dans le remplacement", () => {
    const out = injectShellManifest("const M = /*SHELL_MANIFEST*/ null;", { build: "a", assets: ["/assets/$&-1.js"] });
    expect(out).toContain('"/assets/$&-1.js"');
  });
});
