import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { activityLogs } from "../../shared/schema";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * #130 : l'identifiant de véhicule de l'URL devient un dossier disque dans la destination multer.
 * Une valeur décodée en `1../../../../x` passait `parseInt` (1) puis sortait de `uploads/` par `path.join`.
 */
let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();
const marker = `pwn130-${Date.now().toString(36)}`;

// Toutes les cibles que `path.join("./uploads/documents", "vehicle-<id>")` atteint selon la profondeur.
const escapeTargets = () => [path.resolve(marker), path.resolve("uploads", marker), path.resolve("uploads/documents", marker)];
const suffixedDir = () => path.resolve("uploads/documents/vehicle-12abc");

async function post(rawVehicleId: string) {
  const form = new FormData();
  form.append("name", "Traversée");
  form.append("type", "assurance");
  form.append("document", new Blob(["%PDF-1.4 test"], { type: "application/pdf" }), "doc-test.pdf");
  const res = await fetch(`${baseUrl}/api/vehicles/${rawVehicleId}/documents`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  const user = await createTestUser({ role: "workshop_manager" });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.get("set-cookie")!.split(";")[0];
}, 120000);

afterAll(async () => {
  for (const target of [...escapeTargets(), suffixedDir()]) fs.rmSync(target, { recursive: true, force: true });
  if (ids.userIds.length) await db.delete(activityLogs).where(inArray(activityLogs.userId, ids.userIds));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("POST /api/vehicles/:vehicleId/documents — identifiant hors chiffres", () => {
  it.each([
    ["remontée de 4 niveaux", `1..%2F..%2F..%2F..%2F${marker}`],
    ["remontée de 3 niveaux", `1..%2F..%2F..%2F${marker}`],
    ["remontée de 2 niveaux", `1..%2F..%2F${marker}`],
  ])("%s : 400 lisible, aucun dossier créé hors de uploads/documents/vehicle-<id>", async (_label, rawId) => {
    const res = await post(rawId);
    for (const target of escapeTargets()) expect(fs.existsSync(target), target).toBe(false);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("ID de véhicule invalide");
  });

  it("un identifiant suivi d'un suffixe (`12abc`) est refusé, pas tronqué par parseInt", async () => {
    const res = await post("12abc");
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("ID de véhicule invalide");
    expect(fs.existsSync(suffixedDir())).toBe(false);
  });
});
