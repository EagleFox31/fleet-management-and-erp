import { createServer, type Server } from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { activityLogs } from "../../shared/schema";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { leakText } from "../support/api-error";
import { ROUTE_ID_OUT_OF_RANGE_MESSAGE } from "../../server/middleware/route-id-range-guard";

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
const rejectedDirs = () => ["vehicle-007", "vehicle-99999999999"].map((d) => path.resolve("uploads/documents", d));

/** Contrat `ApiErrorBody` (shared/errors.ts) : message lisible, code, requestId, aucun détail technique. */
function expectApiError400(res: { status: number; body: any }, message = "ID de véhicule invalide") {
  expect(res.status).toBe(400);
  expect(res.body.message).toBe(message);
  expect(res.body.code).toBeTruthy();
  expect(res.body.requestId).toBeTruthy();
  expect(leakText(res.body)).not.toMatch(/stack|ENOENT|EACCES|uploads|\.\.\//i);
}

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
  for (const target of [...escapeTargets(), suffixedDir(), ...rejectedDirs()]) fs.rmSync(target, { recursive: true, force: true });
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
    expectApiError400(res);
  });

  it("un identifiant suivi d'un suffixe (`12abc`) est refusé, pas tronqué par parseInt", async () => {
    const res = await post("12abc");
    expectApiError400(res);
    expect(fs.existsSync(suffixedDir())).toBe(false);
  });

  // Hors int4 : refusé plus tôt par le filet de server/app.ts (route-id-range-guard), même 400.
  it.each([
    ["007", "ID de véhicule invalide"],
    ["99999999999", ROUTE_ID_OUT_OF_RANGE_MESSAGE],
  ])("`%s` (zéro en tête, hors int Postgres) : 400, aucun dossier créé", async (rawId, message) => {
    const res = await post(rawId);
    expectApiError400(res, message);
    for (const dir of rejectedDirs()) expect(fs.existsSync(dir), dir).toBe(false);
  });
});

describe("POST /api/vehicles/:vehicleId/documents — dossier du véhicule remplacé par un lien sortant", () => {
  it("400 « Dossier de destination invalide » (pas « ID de véhicule invalide »), rien écrit dehors", async () => {
    const vehicleId = "2147480001";
    const link = path.resolve("uploads/documents", `vehicle-${vehicleId}`);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-upload-out-"));
    fs.mkdirSync(path.resolve("uploads/documents"), { recursive: true });
    fs.symlinkSync(outside, link, "junction");
    try {
      const res = await post(vehicleId);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Dossier de destination invalide");
      expect(leakText(res.body)).not.toMatch(/uploads|vehicle-|fleet-upload-out|stack/i);
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      // Le lien seul, jamais sa cible par récursion : jonction Windows (rmdir), lien symbolique ailleurs (unlink).
      if (process.platform === "win32") fs.rmdirSync(link);
      else fs.unlinkSync(link);
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("POST /api/vehicles/:vehicleId/documents — échec disque à la création du dossier", () => {
  afterEach(() => vi.restoreAllMocks());

  it("500 générique avec référence, sans chemin ni code système", async () => {
    vi.spyOn(fs, "mkdirSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("EACCES: permission denied, mkdir '/app/uploads/documents/vehicle-1'"), { code: "EACCES" });
    });
    const res = await post("1");
    expect(res.status).toBe(500);
    expect(res.body.message).toContain(`Référence : ${res.body.requestId}`);
    expect(res.body.code).toBeTruthy();
    expect(leakText(res.body)).not.toMatch(/EACCES|uploads|mkdir|stack/i);
  });
});
