import { describe, expect, it } from "vitest";
import { escapeHtml } from "../../../client/src/lib/escape-html";

describe("escapeHtml", () => {
  it("neutralise balises et guillemets", () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe(
      "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;",
    );
  });
  it("valeur absente : chaîne vide", () => {
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(null)).toBe("");
  });
});
