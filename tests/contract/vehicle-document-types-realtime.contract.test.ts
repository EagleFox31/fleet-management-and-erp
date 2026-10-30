import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { vehicleDocumentTypes } from "../../shared/schema";
import { VEHICLE_DOCUMENT_TYPES_PATH, vehicleDocumentTypePath } from "../../shared/contracts/vehicle-document-types";
import { REALTIME_EVENTS } from "../../shared/contracts/realtime-events";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/** Niveau C, T-16 (reste) : evenement temps reel sur creation / modification d'un type de document. */
let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();
const CODE = `zz_rt_${Date.now().toString(36)}`;
const spy = vi.fn();
const previous = (global as any).broadcastUpdate;

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  const admin = await createTestUser({ role: "admin" });
  ids.userIds.push(admin.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: admin.username, password: TEST_USER_PASSWORD }),
  });
  cookie = res.headers.get("set-cookie")!.split(";")[0];
  (global as any).broadcastUpdate = spy;
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previous;
  await db.delete(vehicleDocumentTypes).where(eq(vehicleDocumentTypes.code, CODE));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("vehicle_document_type_changed", { timeout: 120000 }, () => {
  it("est emis, portee broadcast, apres creation et apres modification, pas apres un refus", async () => {
    expect(await call("POST", VEHICLE_DOCUMENT_TYPES_PATH, { code: CODE, label: "Type temps reel", validityMonths: 12 })).toBe(201);
    expect(spy).toHaveBeenCalledTimes(1);
    const [event, data] = spy.mock.calls[0];
    expect(event).toBe("vehicle_document_type_changed");
    expect(data.payload).toEqual({ code: CODE });
    expect(data.scope).toEqual(REALTIME_EVENTS.vehicle_document_type_changed.scope);
    expect(data.scope).toEqual({ type: "broadcast" });

    expect(await call("PATCH", vehicleDocumentTypePath(CODE), { label: "Libelle modifie" })).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][1].payload).toEqual({ code: CODE });

    expect(await call("POST", VEHICLE_DOCUMENT_TYPES_PATH, { code: CODE, label: "Doublon", validityMonths: 6 })).toBe(409);
    expect(await call("PATCH", vehicleDocumentTypePath("zz_inconnu"), { label: "ab" })).toBe(404);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
