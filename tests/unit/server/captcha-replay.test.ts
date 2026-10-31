import { describe, expect, it } from "vitest";
import { MemoryCaptchaReplayStore } from "../../../server/services/captcha-service";

describe("MemoryCaptchaReplayStore", () => {
  it("accepte une cle une fois, refuse le rejeu, oublie apres expiration", () => {
    let t = 1000;
    const s = new MemoryCaptchaReplayStore(() => t);
    expect(s.claim("a", 2000)).toBe(true);
    expect(s.claim("a", 2000)).toBe(false);
    expect(s.claim("b", 2000)).toBe(true);
    t = 2001;
    expect(s.claim("a", 3000)).toBe(true);
  });
});
