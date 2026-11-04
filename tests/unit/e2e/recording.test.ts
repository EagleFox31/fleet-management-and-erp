import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRecording, RECORD_VIEWPORT, recordingContextOptions, recordingDirName } from "../../../e2e/helpers/recording";

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
const outputPath = (name: string) => `/out/${name}`;

describe("enregistrement vidéo des contextes ouverts à la main (E2E_RECORD)", () => {
  it("sans E2E_RECORD=1 : aucune option, comportement par défaut inchangé", () => {
    expect(recordingContextOptions("magasin", outputPath, env({}))).toEqual({});
    expect(recordingContextOptions("magasin", outputPath, env({ E2E_RECORD: "true" }))).toEqual({});
    expect(isRecording(env({ E2E_RECORD: "0" }))).toBe(false);
  });

  it("avec E2E_RECORD=1 : vidéo par profil dans le dossier du test, à la taille du viewport", () => {
    expect(recordingContextOptions("Chef d'atelier", outputPath, env({ E2E_RECORD: "1" }))).toEqual({
      viewport: RECORD_VIEWPORT,
      recordVideo: { dir: "/out/video-chef-d-atelier", size: RECORD_VIEWPORT },
    });
  });

  it("le nom de dossier reste sûr pour un libellé vide ou exotique", () => {
    expect(recordingDirName("../..")).toBe("video-contexte");
    expect(recordingDirName("techB")).toBe("video-techb");
  });

  it("playwright.config.ts lit le même interrupteur et le même viewport", () => {
    const config = readFileSync("playwright.config.ts", "utf8");
    expect(config).toMatch(/const record = isRecording\(\)/);
    expect(config).toMatch(/RECORD_VIEWPORT/);
  });

  it("aucune spec n'ouvre de contexte navigateur sans newE2EContext (il ne serait pas filmé)", () => {
    const offenders = readdirSync("e2e")
      .filter((f) => f.endsWith(".spec.ts"))
      .filter((f) => /\bbrowser\.newContext\(/.test(readFileSync(`e2e/${f}`, "utf8")));
    expect(offenders, "Utiliser newE2EContext(browser, \"<profil>\") (e2e/helpers/contexts.ts)").toEqual([]);
  });
});
