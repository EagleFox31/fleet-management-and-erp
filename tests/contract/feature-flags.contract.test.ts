import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { featureFlagsResponseSchema } from "../../shared/feature-flags";
import { getContractApp } from "../support/app";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { cleanupCreated, createIdBag } from "../support/cleanup";

let server: Server;
let baseUrl = "";
const ids = createIdBag();

async function call(method: string, path: string, cookie?: string) {
  const r = await fetch(baseUrl + path, { method, headers: cookie ? { Cookie: cookie } : {} });
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("GET /api/feature-flags et squelettes", { timeout: 120000 }, () => {
  it("refuse sans session, puis sert le contrat à un technicien; un SHOULD coupé répond 404 normalisé", async () => {
    expect((await call("GET", "/api/feature-flags")).status).toBe(401);

    const user = await createTestUser({ role: "technician" });
    ids.userIds.push(user.id);
    const login = await fetch(baseUrl + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];

    const flags = await call("GET", "/api/feature-flags", cookie);
    expect(flags.status).toBe(200);
    expect(featureFlagsResponseSchema.safeParse(flags.body).success).toBe(true);

    const off = await call("GET", "/api/incidents", cookie);
    if ((flags.body as Record<string, boolean>).incidents === false) {
      expect(off.status).toBe(404);
      expect(off.body).toMatchObject({ code: "NOT_FOUND" });
    } else {
      expect(off.status).toBe(501);
    }
  });
});
