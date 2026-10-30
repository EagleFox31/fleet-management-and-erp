import { describe, expect, it } from "vitest";
import { isChannelEnabled } from "../../../server/services/notification-preference-rule";

describe("isChannelEnabled", () => {
  it("sans ligne : in-app actif, e-mail coupé", () => {
    expect(isChannelEnabled(undefined, "inApp")).toBe(true);
    expect(isChannelEnabled(undefined, "email")).toBe(false);
  });
  it("avec ligne : suit la ligne", () => {
    expect(isChannelEnabled({ inApp: false, email: true }, "inApp")).toBe(false);
    expect(isChannelEnabled({ inApp: false, email: true }, "email")).toBe(true);
  });
});
