import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";

/**
 * Santé : réponse publique minimale (clés autorisées seulement) ;
 * le détail descriptif est réservé à l'administrateur.
 */
const ALLOWED_PUBLIC_KEYS = ["status", "version"];

const ids = createIdBag();
let api: Awaited<ReturnType<typeof startContractActors<"admin" | "staff">>>;

beforeAll(async () => {
  api = await startContractActors({ admin: "admin", staff: "logistics" }, ids.userIds);
});

afterAll(async () => {
  await api?.close();
  await cleanupCreated(ids);
});

describe("GET /api/health", () => {
  it("anonyme : 200 avec les seules clés autorisées", async () => {
    const { status, body } = await api.call("GET", "/api/health");

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(Object.keys(body).sort()).toEqual(ALLOWED_PUBLIC_KEYS);
    expect(typeof body.version).toBe("string");
  });

  it("personnel non admin : même réponse minimale", async () => {
    const { status, body } = await api.call("GET", "/api/health", { actor: "staff" });

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(ALLOWED_PUBLIC_KEYS);
  });
});

describe("GET /api/health/details", () => {
  it("anonyme : refusé", async () => {
    const { status } = await api.call("GET", "/api/health/details");
    expect(status).toBe(401);
  });

  it("personnel non admin : 403", async () => {
    const { status } = await api.call("GET", "/api/health/details", { actor: "staff" });
    expect(status).toBe(403);
  });

  it("admin : 200 avec le détail", async () => {
    const { status, body } = await api.call("GET", "/api/health/details", { actor: "admin" });

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.services).toBeDefined();
  });
});
