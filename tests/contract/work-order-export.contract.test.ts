import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { workOrders } from "../../shared/schema";
import { DOCX_CONTENT_TYPE } from "../../shared/contracts/work-order-export";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";

/** Export Word d'un OT (T-24): type MIME, signature zip, 404, 400, rôles. Écrit en base, nettoie. */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const workOrderIds: number[] = [];

async function get(path: string, cookie?: string) {
  const response = await fetch(baseUrl + path, { headers: cookie ? { Cookie: cookie } : {} });
  return { response, bytes: Buffer.from(await response.arrayBuffer()) };
}

async function login(username: string): Promise<string> {
  const res = await fetch(baseUrl + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  for (const id of workOrderIds) await db.delete(workOrders).where(eq(workOrders.id, id));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("export Word d'un OT", { timeout: 180000 }, () => {
  it("sert le .docx, refuse les mauvais rôles et les OT d'autrui", async () => {
    const manager = await createTestUser({ role: "workshop_manager" });
    const techA = await createTestUser({ role: "technician" });
    const techB = await createTestUser({ role: "technician" });
    const warehouse = await createTestUser({ role: "warehouse" });
    const client = await createTestUser({ role: "client" });
    ids.userIds.push(manager.id, techA.id, techB.id, warehouse.id, client.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const [workOrder] = await db
      .insert(workOrders)
      .values({ vehicleId: vehicle.id, title: "TEST export Word", status: "in_progress", technicianId: techA.id })
      .returning();
    workOrderIds.push(workOrder.id);
    const [mgr, a, b, wh, cl] = await Promise.all(
      [manager, techA, techB, warehouse, client].map((u) => login(u.username)),
    );
    const url = (doc: string, id = workOrder.id) => `/api/work-orders/${id}/export?doc=${doc}`;

    // Sans session: 401.
    expect((await get(url("ot"))).response.status).toBe(401);

    // OT: en-tête, nom de fichier, signature zip.
    const ot = await get(url("ot"), a);
    expect(ot.response.status).toBe(200);
    expect(ot.response.headers.get("content-type")).toContain(DOCX_CONTENT_TYPE);
    expect(ot.response.headers.get("content-disposition")).toContain(`ordre-travail-${workOrder.id}.docx`);
    expect(ot.bytes.subarray(0, 2).toString()).toBe("PK");
    expect(Number(ot.response.headers.get("content-length"))).toBe(ot.bytes.length);

    // Bon de sortie: magasinier oui, technicien et client non.
    const voucher = await get(url("bon-sortie"), wh);
    expect(voucher.response.status).toBe(200);
    expect(voucher.response.headers.get("content-disposition")).toContain(`bon-sortie-${workOrder.id}.docx`);
    expect(voucher.bytes.subarray(0, 2).toString()).toBe("PK");
    expect((await get(url("bon-sortie"), a)).response.status).toBe(403);
    expect((await get(url("bon-sortie"), cl)).response.status).toBe(403);

    // OT: chef d'atelier oui, client non, autre technicien non.
    expect((await get(url("ot"), mgr)).response.status).toBe(200);
    expect((await get(url("ot"), cl)).response.status).toBe(403);
    expect((await get(url("ot"), b)).response.status).toBe(403);

    // 404 pour un OT absent, 400 pour un document inconnu.
    expect((await get(url("ot", 2147483000), mgr)).response.status).toBe(404);
    expect((await get(url("facture"), mgr)).response.status).toBe(400);
  });
});
