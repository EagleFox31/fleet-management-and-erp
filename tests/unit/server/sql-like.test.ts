import { describe, expect, it } from "vitest";
import { escapeLike } from "../../../server/lib/sql-like";

describe("escapeLike", () => {
  it("préfixe % et _ d'un antislash", () => {
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
  });

  it("échappe l'antislash lui-même", () => {
    expect(escapeLike("a\\b")).toBe("a\\\\b");
    expect(escapeLike("\\%")).toBe("\\\\\\%");
  });

  it("laisse le texte ordinaire intact, ne produit jamais de gabarit littéral", () => {
    expect(escapeLike("AB-123 'x'")).toBe("AB-123 'x'");
    expect(escapeLike("50%")).not.toContain("${");
  });

  it("retire l'octet nul", () => {
    expect(escapeLike("a\u0000b")).toBe("ab");
  });
});
