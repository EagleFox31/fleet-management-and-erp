import { describe, expect, it } from "vitest";
import { getContractApp } from "../support/app";
import { requestJson } from "../support/http";

describe("GET /api/health", () => {
  it("répond 200 avec status ok sans session", async () => {
    const app = await getContractApp();
    const { status, body } = await requestJson(app, "GET", "/api/health");

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "ok" });
  });
});
