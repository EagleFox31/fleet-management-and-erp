import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { activityLogs, vehicleDocuments } from "../../shared/schema";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";
import { leakText } from "../support/api-error";

/**
 * P3-2 lot 2b, M2 et M3 : refus d'un téléversement. Le message est une phrase utilisateur
 * (jamais `err.message` brut), l'extension doit correspondre au type MIME déclaré, et le
 * refus ne laisse ni ligne ni fichier.
 */
let server: Server;
let baseUrl = "";
let vehicleId = 0;
let cookie = "";
const ids = createIdBag();
const vehicleDir = () => path.join("./uploads/documents", `vehicle-${vehicleId}`);
const filesOnDisk = () => (fs.existsSync(vehicleDir()) ? fs.readdirSync(vehicleDir()).filter((f) => f !== ".gitkeep") : []);

async function upload(filename: string, mime: string, size = 16) {
  const form = new FormData();
  form.append("name", "TEST document");
  form.append("type", "carte_grise");
  form.append("document", new Blob(["x".repeat(size)], { type: mime }), filename);
  const res = await fetch(`${baseUrl}/api/vehicles/${vehicleId}/documents`, { method: "POST", headers: { Cookie: cookie }, body: form });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  const user = await createTestUser({ role: "workshop_manager" });
  ids.userIds.push(user.id);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  const vehicle = await createTestVehicle();
  vehicleId = vehicle.id;
  ids.vehicleIds.push(vehicle.id);
}, 120000);

afterAll(async () => {
  await db.delete(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
  for (const f of filesOnDisk()) fs.rmSync(path.join(vehicleDir(), f), { recursive: true, force: true });
  if (fs.existsSync(vehicleDir()) && fs.readdirSync(vehicleDir()).length === 0) fs.rmdirSync(vehicleDir());
  if (ids.userIds.length) await db.delete(activityLogs).where(inArray(activityLogs.userId, ids.userIds));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("POST /api/vehicles/:id/documents : refus de fichier", { timeout: 120000 }, () => {
  it("M3 : extension incohérente avec le MIME (exe déclaré pdf) : 400 lisible, rien écrit", async () => {
    const res = await upload("virus.exe", "application/pdf");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/extension/i);
    expect(leakText(res.body)).not.toMatch(/EACCES|ENOSPC|stack|\.exe'/);
    expect(filesOnDisk()).toEqual([]);
    expect(await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId))).toHaveLength(0);
  });

  it("M3 : png déclaré pour un .jpg : 400", async () => {
    expect((await upload("photo.jpg", "image/png")).status).toBe(400);
  });

  it("type MIME non admis : 400 avec la phrase utilisateur", async () => {
    const res = await upload("note.txt", "text/plain");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Type de fichier non supporté/);
  });

  it("M2 : fichier trop gros : 400, message de taille, pas de détail multer", async () => {
    const res = await upload("gros.pdf", "application/pdf", 10 * 1024 * 1024 + 1024);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Le fichier dépasse la taille maximale autorisée.");
    expect(leakText(res.body)).not.toMatch(/LIMIT_FILE_SIZE|MulterError/);
  });

  it("M2 : corps multipart tronqué (erreur brute de la librairie) : 400 générique, rien de technique", async () => {
    const boundary = "----TESTboundary";
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\nabc`;
    const res = await fetch(`${baseUrl}/api/vehicles/${vehicleId}/documents`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const json = await res.json().catch(() => null);
    expect(res.status).toBe(400);
    expect(json.message).toBe("Le fichier téléversé est invalide.");
    expect(JSON.stringify(json)).not.toMatch(/Unexpected end|form|Multipart/i);
  });

  it("extension et MIME cohérents : accepté (201)", async () => {
    expect((await upload("carte.pdf", "application/pdf")).status).toBe(201);
  });
});
