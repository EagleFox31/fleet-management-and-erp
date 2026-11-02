import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { documentRenewalRequests, vehicleDocuments } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";

/**
 * DOC2 : transitions d'une demande de renouvellement.
 * pending -> in_progress -> completed ; pending / in_progress -> rejected.
 * Terminée ou rejetée : plus aucun changement. Écrit en base ; le véhicule
 * supprimé emporte document et demandes (cascade).
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("statut d'une demande de renouvellement", { timeout: 180000 }, () => {
  it("suit le cycle de vie et refuse les retours en arrière", async () => {
    const secretary = await createTestUser({ role: "secretary" });
    ids.userIds.push(secretary.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const [document] = await db
      .insert(vehicleDocuments)
      .values({
        vehicleId: vehicle.id,
        name: "TEST assurance",
        type: "assurance",
        filename: "test.pdf",
        filesize: 1,
        fileType: "application/pdf",
        filePath: "uploads/test-inexistant.pdf",
      })
      .returning();

    const insertRequest = async (status: "pending" | "in_progress" | "completed" | "rejected") => {
      const [row] = await db
        .insert(documentRenewalRequests)
        .values({ vehicleId: vehicle.id, vehicleDocumentId: document.id, documentType: "assurance", status })
        .returning();
      return row.id;
    };

    const login = await call("POST", "/api/auth/login", {
      body: { username: secretary.username, password: TEST_USER_PASSWORD },
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const patch = (id: number, body: unknown) => call("PATCH", `/api/document-renewals/requests/${id}/status`, { cookie, body });

    // Chemin nominal.
    const nominal = await insertRequest("pending");
    expect((await patch(nominal, { status: "in_progress" })).status).toBe(200);
    const done = await patch(nominal, { status: "completed", newExpiryDate: "2027-12-31" });
    expect(done.status).toBe(200);
    expect(done.body.completedAt).toBeTruthy();

    // Terminée : ni rouverte, ni rejetée après coup.
    for (const target of ["pending", "in_progress", "rejected"]) {
      const res = await patch(nominal, { status: target });
      expect(res.status).toBe(409);
      expect(typeof res.body?.message).toBe("string");
    }
    const [kept] = await db.select().from(documentRenewalRequests).where(eq(documentRenewalRequests.id, nominal));
    expect(kept.status).toBe("completed");

    // Rejetée : définitive.
    const rejected = await insertRequest("rejected");
    expect((await patch(rejected, { status: "in_progress" })).status).toBe(409);

    // Une demande en attente n'est pas terminée sans avoir été traitée.
    const pending = await insertRequest("pending");
    expect((await patch(pending, { status: "completed" })).status).toBe(409);
    expect((await patch(pending, { status: "rejected" })).status).toBe(200);

    // Date illisible : 400 lisible, pas une erreur SQL en 500.
    const inProgress = await insertRequest("in_progress");
    const badDate = await patch(inProgress, { status: "completed", newExpiryDate: "31/12/2027" });
    expect(badDate.status).toBe(400);
    const [untouched] = await db.select().from(documentRenewalRequests).where(eq(documentRenewalRequests.id, inProgress));
    expect(untouched.status).toBe("in_progress");

    // Statut inchangé : permis (rejouable).
    expect((await patch(inProgress, { status: "in_progress" })).status).toBe(200);
  });
});
