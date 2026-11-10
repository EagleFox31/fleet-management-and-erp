import { describe, expect, it } from "vitest";
import { mediaTypeOf, requireJsonContentType } from "../../../server/middleware/require-json-content-type";

/** Matrice du garde anti-CSRF (écritures /api : JSON ou multipart seulement). */
function run(method: string, path: string, headers: Record<string, string> = {}) {
  let result: unknown = "pas appelé";
  requireJsonContentType({ method, path, headers } as never, {} as never, (err?: unknown) => {
    result = err ?? "ok";
  });
  return result as string | { status: number };
}

describe("requireJsonContentType", () => {
  it("normalise le type (casse, paramètres)", () => {
    expect(mediaTypeOf("Application/JSON; charset=UTF-8")).toBe("application/json");
    expect(mediaTypeOf(undefined)).toBe("");
  });

  it.each([
    ["POST", { "content-type": "application/json" }],
    ["POST", { "content-type": "application/json; charset=utf-8" }],
    ["PATCH", { "content-type": "Application/JSON", "content-length": "4" }],
    ["POST", { "content-type": "multipart/form-data; boundary=x" }],
    ["GET", {}],
    ["HEAD", {}],
    ["DELETE", { "content-length": "0" }],
    ["PUT", {}],
  ])("laisse passer %s %j", (method, headers) => {
    expect(run(method, "/api/x", headers)).toBe("ok");
  });

  it.each([
    ["POST", {}],
    ["POST", { "content-type": "application/x-www-form-urlencoded", "content-length": "5" }],
    ["POST", { "content-type": "text/plain" }],
    ["POST", { "content-type": "application/json-patch" }],
    ["PATCH", { "content-type": "text/plain", "content-length": "5" }],
    ["DELETE", { "content-type": "application/x-www-form-urlencoded", "transfer-encoding": "chunked" }],
  ])("refuse %s %j en 415", (method, headers) => {
    expect(run(method, "/api/x", headers)).toMatchObject({ status: 415 });
  });

  it("ne touche ni les chemins hors /api ni le préfixe en majuscules à tort", () => {
    expect(run("POST", "/webhook", { "content-type": "text/plain" })).toBe("ok");
    expect(run("POST", "/API/x", { "content-type": "text/plain" })).toMatchObject({ status: 415 });
  });
});
