import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { upgradeRoute } from "../../../server/lib/upgrade-route";

describe("upgradeRoute", () => {
  it.each([["/ws"], ["/ws?token=1"]])("%s : temps reel de l'app", (url) => {
    expect(upgradeRoute(url, false)).toBe("app");
    expect(upgradeRoute(url, true)).toBe("app");
  });

  it.each([["/"], ["/vite-hmr"], ["/ws/"], ["/WS"], [undefined]])("%s : Vite en developpement, refus sinon", (url) => {
    expect(upgradeRoute(url, true)).toBe("vite");
    expect(upgradeRoute(url, false)).toBe("reject");
  });

  it("server/index.ts detruit la socket d'un upgrade refuse", () => {
    const index = readFileSync("server/index.ts", "utf8");
    expect(index).toMatch(/const route = upgradeRoute\(request\.url, [^)]+\);/);
    expect(index).toMatch(/if \(route === "reject"\) socket\.destroy\(\);/);
  });
});
