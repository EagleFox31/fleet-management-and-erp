import { describe, expect, it } from "vitest";
import { FILE_SCOPED_ENV, restoreEnv, snapshotEnv } from "../../support/env-restore";

describe("snapshotEnv / restoreEnv", () => {
  it("rend la valeur changée et supprime la clé absente au départ", () => {
    const env: NodeJS.ProcessEnv = { TZ: "UTC" };
    const snapshot = snapshotEnv(["TZ", "FEATURE_FLAGS"], env);
    env.TZ = "Africa/Douala";
    env.FEATURE_FLAGS = "incidents=on";
    restoreEnv(snapshot, env);
    expect(env).toEqual({ TZ: "UTC" });
    expect("FEATURE_FLAGS" in env).toBe(false);
  });

  it("ne touche pas aux clés hors instantané", () => {
    const env: NodeJS.ProcessEnv = { OTHER: "a" };
    const snapshot = snapshotEnv(["FEATURE_FLAGS"], env);
    env.OTHER = "b";
    restoreEnv(snapshot, env);
    expect(env.OTHER).toBe("b");
  });

  it("couvre toutes les variables que les contrats affectent", async () => {
    const { readdirSync, readFileSync } = await import("fs");
    const { join } = await import("path");
    const dir = join(__dirname, "../../contract");
    const assigned = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      for (const m of readFileSync(join(dir, file), "utf8").matchAll(/process\.env\.([A-Z_]+)\s*=[^=]/g)) assigned.add(m[1]);
    }
    expect([...assigned].filter((key) => !(FILE_SCOPED_ENV as readonly string[]).includes(key)).sort()).toEqual([]);
  });
});
