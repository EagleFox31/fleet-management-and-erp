import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_APP_ROLES } from "../../../shared/constants/roles";

const source = readFileSync(resolve(__dirname, "../../../client/src/pages/landing.tsx"), "utf8").replace(/\r\n/g, "\n");

/** Ids des profils déclarés dans le tableau `userProfiles` (entrées de premier niveau). */
function landingProfileIds(): string[] {
  // Le tableau peut porter une annotation de type : « const userProfiles: { … }[] = [ ».
  const declaration = /^const userProfiles\b[^]*?= \[$/m.exec(source);
  const start = declaration ? declaration.index : -1;
  const end = source.indexOf("\n];\n", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = source.slice(start, end);
  return [...block.matchAll(/^ {4}id: "([a-z_]+)",$/gm)].map((m) => m[1]);
}

describe("landing : profils et nombre de rôles", () => {
  it("userProfiles = ALL_APP_ROLES sans le rôle hérité 'user', sans doublon", () => {
    const ids = landingProfileIds();
    expect(new Set(ids).size).toBe(ids.length);
    const attendus = ALL_APP_ROLES.filter((r) => r !== "user");
    expect([...ids].sort()).toEqual([...attendus].sort());
  });

  it("aucun nombre de rôles écrit en dur dans landing.tsx", () => {
    const enDur = source.match(/\d+\s+(rôles|Rôles|Profils)/g);
    expect(enDur).toBeNull();
  });

  it("le nombre affiché dérive de userProfiles.length", () => {
    expect(source).toContain("const ROLE_COUNT = userProfiles.length;");
  });
});
