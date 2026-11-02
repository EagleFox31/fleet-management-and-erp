import { describe, expect, it } from "vitest";
import { isoDateSchema } from "../../../shared/contracts/common";

describe("isoDateSchema : date calendaire réelle", () => {
  it.each(["2033-02-28", "2032-02-29", "2033-12-31", "2000-02-29"])("accepte %s", (value) => {
    expect(isoDateSchema.safeParse(value).success).toBe(true);
  });

  it.each(["2033-02-30", "2033-02-29", "2033-04-31", "2033-13-01", "2033-00-10", "1900-02-29", "2033-1-01", "31/12/2033", ""])(
    "refuse %s",
    (value) => {
      expect(isoDateSchema.safeParse(value).success).toBe(false);
    },
  );
});
