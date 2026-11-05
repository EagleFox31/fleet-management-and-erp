import { describe, expect, it } from "vitest";
import { servedContentType, UNTRUSTED_CONTENT_TYPE } from "../../../server/lib/uploaded-file-response";

describe("servedContentType : type servi pour un fichier téléversé", () => {
  it.each([
    ["application/pdf", "uploads/a/doc.pdf", "application/pdf"],
    ["APPLICATION/PDF", "uploads/a/DOC.PDF", "application/pdf"],
    ["image/png", "uploads/a/photo.png", "image/png"],
    ["image/jpeg", "uploads/a/photo.jpeg", "image/jpeg"],
    ["image/jpg", "uploads/a/photo.jpg", "image/jpeg"],
  ])("%s pour %s -> %s", (declared, path, expected) => {
    expect(servedContentType(declared, path)).toBe(expected);
  });

  it.each([
    ["text/html", "uploads/a/page.html"],
    ["image/svg+xml", "uploads/a/image.svg"],
    ["application/pdf", "uploads/a/image.svg"],
    ["application/pdf", "uploads/a/sans-extension"],
    ["", "uploads/a/doc.pdf"],
    [null, "uploads/a/doc.pdf"],
    [undefined, "uploads/a/doc.pdf"],
  ])("%s pour %s -> octet-stream", (declared, path) => {
    expect(servedContentType(declared, path)).toBe(UNTRUSTED_CONTENT_TYPE);
  });
});
