import { messageText } from "../support/api-error";
import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { activityLogs, vehicleDocuments } from "../../shared/schema";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Dépôt de document véhicule (patron de #178) : si la synchro du miroir échoue puis que le retrait
 * de la ligne échoue aussi, la ligne reste en base. Le fichier qu'elle référence doit rester sur le
 * disque : le supprimer laisserait un document pointant vers un fichier absent.
 *
 * Pas de `vi.mock` de module : la suite contrat tourne avec `isolate: false`, le mock fuirait vers
 * les fichiers suivants. Les échecs passent par des spies restaurés dans le test.
 */

let server: Server;
let baseUrl = "";
let vehicleId = 0;
let cookie = "";
const ids = createIdBag();
const vehicleDir = () => path.join("./uploads/documents", `vehicle-${vehicleId}`);
const filesOnDisk = () => (fs.existsSync(vehicleDir()) ? fs.readdirSync(vehicleDir()).filter((f) => f !== ".gitkeep") : []);

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

describe("POST /api/vehicles/:id/documents : ligne restée en base après un double échec", { timeout: 120000 }, () => {
  it("synchro du miroir puis retrait de la ligne en échec : 500 lisible, la ligne et son fichier restent", async () => {
    // La synchro du miroir écrit `vehicles` par `db.update` (échéance carte grise) : elle échoue ici.
    const update = vi.spyOn(db, "update").mockImplementation(() => {
      throw new Error("TEST synchro du miroir indisponible");
    });
    const remove = vi.spyOn(storage, "deleteVehicleDocument").mockRejectedValue(new Error("TEST retrait indisponible"));
    try {
      const form = new FormData();
      form.append("name", "TEST document");
      form.append("type", "carte_grise");
      form.append("expiryDate", "2031-01-01");
      form.append("document", new Blob(["x".repeat(16)], { type: "application/pdf" }), "orphelin.pdf");
      const res = await fetch(`${baseUrl}/api/vehicles/${vehicleId}/documents`, { method: "POST", headers: { Cookie: cookie }, body: form });
      update.mockRestore();
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(messageText(body)).not.toMatch(/TEST|synchro|retrait/);
      expect(remove).toHaveBeenCalledTimes(1);

      const rows = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
      expect(rows).toHaveLength(1);
      expect(fs.existsSync(rows[0].filePath)).toBe(true);
    } finally {
      update.mockRestore();
      remove.mockRestore();
    }
  });
});
