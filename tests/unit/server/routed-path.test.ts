import { describe, expect, it } from "vitest";
import { isApiPath, routedPath } from "../../../server/lib/routed-path";

/** Prefixe /api lu comme le montage Express : insensible a la casse, segment entier. */
describe("isApiPath", () => {
  it.each(["/api", "/api/", "/api/vehicles", "/API/vehicles", "/Api/users/62"])("%s : route d'API", (path) => {
    expect(isApiPath(path)).toBe(true);
  });

  it.each(["/", "/apix", "/apix/vehicles", "/assets/api.js", "/ap", "api/vehicles"])("%s : hors API", (path) => {
    expect(isApiPath(path)).toBe(false);
  });
});

describe("routedPath", () => {
  it("base du montage + chemin, barres repetees reduites", () => {
    expect(routedPath({ baseUrl: "/api", path: "//users/62" })).toBe("/api/users/62");
    expect(routedPath({ baseUrl: "", path: "" })).toBe("/");
  });
});
