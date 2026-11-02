import { existsSync, readdirSync, rmSync } from "fs";
import { eq, inArray } from "drizzle-orm";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { alerts, vehicleAcquisitionWorkflows, workflowDocuments, workOrders } from "../../shared/schema";
import { createTestVehicle } from "../support/factories";
import { startContractSession } from "../support/contract-session";

/**
 * Gardes de rôle posées après les pistes D, E, F :
 * - `POST /api/test-date-maintenance` (alertes de maintenance) : secrétariat, logistique, atelier, admin ;
 * - `POST /api/document-renewals/quick-renew` : même ensemble, contrôlé AVANT le téléversement du
 *   justificatif (un refus ne doit laisser aucun fichier sur le disque) ;
 * - `POST /api/workflows/:sessionId/documents` : personnel d'acquisition (admin, secrétariat, logistique, chef d'atelier) et client propriétaire de la session.
 * Le cas autorisé s'arrête sur une erreur de validation (400) : aucune écriture.
 */
type Actor = "admin" | "secretary" | "client" | "client2" | "driver" | "technician" | "boss";
const workOrderIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;

const proofDir = join(process.cwd(), "uploads", "document-renewals", "proofs");
const proofFiles = () => {
  try {
    return readdirSync(proofDir);
  } catch {
    return [] as string[];
  }
};

beforeAll(async () => {
  session = await startContractSession<Actor>({
    admin: "admin",
    secretary: "secretary",
    client: "client",
    client2: "client",
    driver: "driver",
    technician: "technician",
    boss: "workshop_manager",
  });
}, 60000);

afterAll(async () => {
  if (workOrderIds.length > 0) {
    await db.delete(alerts).where(inArray(alerts.link, workOrderIds.map((id) => `/maintenance/work-orders/${id}`)));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  await session.stop();
});

describe("POST /api/test-date-maintenance", { timeout: 60000 }, () => {
  const body = { alertType: "insurance" }; // vehicleId manquant : 400 si la garde laisse passer

  it.each(["client", "driver", "technician"] as const)("%s est refusé (403)", async (actor) => {
    const res = await session.call("POST", "/api/test-date-maintenance", { actor, body });
    expect(res.status).toBe(403);
  });

  it.each(["admin", "secretary"] as const)("%s passe la garde et atteint la validation (400)", async (actor) => {
    const res = await session.call("POST", "/api/test-date-maintenance", { actor, body });
    expect(res.status).toBe(400);
  });

  it("sans session : 401", async () => {
    expect((await session.call("POST", "/api/test-date-maintenance", { actor: null, body })).status).toBe(401);
  });
});

describe("POST /api/workflows/:sessionId/documents", { timeout: 60000 }, () => {
  const sessionId = `TEST-wfdoc-${Date.now()}`;
  let workflowId = 0;

  beforeAll(async () => {
    const [row] = await db
      .insert(vehicleAcquisitionWorkflows)
      .values({ userId: session.userId("client"), sessionId, workflowData: {} })
      .returning({ id: vehicleAcquisitionWorkflows.id });
    workflowId = row.id;
  });

  afterAll(async () => {
    await db.delete(workflowDocuments).where(eq(workflowDocuments.sessionId, sessionId));
    await db.delete(vehicleAcquisitionWorkflows).where(eq(vehicleAcquisitionWorkflows.id, workflowId));
    rmSync(join(process.cwd(), "uploads", "workflows", sessionId), { recursive: true, force: true });
  });

  const upload = (actor: Actor, id = workflowId) => {
    const form = new FormData();
    form.append("workflowId", String(id));
    form.append("documentType", "carte_grise");
    form.append("document", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), "TEST-doc.pdf");
    return session.raw("POST", `/api/workflows/${sessionId}/documents`, actor, form);
  };

  it.each(["driver", "technician"] as const)("%s est refusé (403)", async (actor) => {
    const res = await session.call("POST", `/api/workflows/${sessionId}/documents`, { actor, body: {} });
    expect(res.status).toBe(403);
  });

  it("l'admin et la secrétaire passent la garde et atteignent la validation (400, aucun fichier)", async () => {
    for (const actor of ["admin", "secretary"] as const) {
      const res = await session.call("POST", `/api/workflows/${sessionId}/documents`, { actor, body: {} });
      expect(res.status).toBe(400);
    }
  });

  it("un autre client ne peut pas alimenter la session d'un propriétaire (403, rien écrit)", async () => {
    const res = await upload("client2");
    expect(res.status).toBe(403);
    expect(existsSync(join(process.cwd(), "uploads", "workflows", sessionId))).toBe(false);
  });

  it("un client qui envoie son propre workflowId avec le sessionId d'un autre est refusé (403, rien écrit)", async () => {
    const otherSessionId = `TEST-wfdoc-other-${Date.now()}`;
    const [own] = await db
      .insert(vehicleAcquisitionWorkflows)
      .values({ userId: session.userId("client2"), sessionId: otherSessionId, workflowData: {} })
      .returning({ id: vehicleAcquisitionWorkflows.id });
    try {
      // client2 est bien propriétaire de `own`, mais le chemin vise la session d'un autre.
      const res = await upload("client2", own.id);
      expect(res.status).toBe(403);
      expect(existsSync(join(process.cwd(), "uploads", "workflows", sessionId))).toBe(false);
    } finally {
      await db.delete(vehicleAcquisitionWorkflows).where(eq(vehicleAcquisitionWorkflows.id, own.id));
    }
  });

  it.each(["admin", "client"] as const)("workflowId non entier : 400 lisible, rien écrit (%s)", async (actor) => {
    for (const bad of ["abc", "1.5", "-3", "0"]) {
      const form = new FormData();
      form.append("workflowId", bad);
      form.append("documentType", "carte_grise");
      form.append("document", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), "TEST-doc.pdf");
      const res = await session.raw("POST", `/api/workflows/${sessionId}/documents`, actor, form);
      expect(res.status, bad).toBe(400);
      expect(JSON.stringify(await res.json())).not.toMatch(/sql|syntax|NaN/i);
    }
    expect(existsSync(join(process.cwd(), "uploads", "workflows", sessionId))).toBe(false);
  });

  it("le client propriétaire alimente sa session (201)", async () => {
    const res = await upload("client");
    expect(res.status).toBe(201);
    const rows = await db.select().from(workflowDocuments).where(eq(workflowDocuments.sessionId, sessionId));
    expect(rows).toHaveLength(1);
  });
});

describe("POST /api/document-renewals/quick-renew : garde avant téléversement", { timeout: 60000 }, () => {
  it("un client qui joint un justificatif est refusé (403) et rien n'est écrit sur le disque", async () => {
    const before = proofFiles();
    const form = new FormData();
    form.append("vehicleId", "1");
    form.append("proofFile", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), "TEST-garde-client.pdf");
    const res = await session.raw("POST", "/api/document-renewals/quick-renew", "client", form);
    expect(res.status).toBe(403);
    expect(proofFiles().filter((name) => !before.includes(name))).toEqual([]);
  });

  it("un chauffeur est refusé (403)", async () => {
    const res = await session.call("POST", "/api/document-renewals/quick-renew", { actor: "driver", body: {} });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/technician/work-orders/:id/status : alerte d'avancement", { timeout: 60000 }, () => {
  it("le démarrage par le technicien alerte le chef d'atelier (« Intervention démarrée »)", async () => {
    const vehicle = await createTestVehicle();
    session.ids.vehicleIds.push(vehicle.id);
    const [wo] = await db
      .insert(workOrders)
      .values({ vehicleId: vehicle.id, title: "TEST alerte avancement", status: "pending", technicianId: session.userId("technician") })
      .returning();
    workOrderIds.push(wo.id);

    const started = await session.call("PATCH", `/api/technician/work-orders/${wo.id}/status`, {
      actor: "technician",
      body: { status: "in_progress" },
    });
    expect(started.status).toBe(200);

    let found = false;
    for (let attempt = 0; attempt < 20 && !found; attempt += 1) {
      const list = await session.call("GET", "/api/alerts", { actor: "boss" });
      found = JSON.stringify(list.body).includes(`Intervention démarrée — OT #${wo.id}`);
      if (!found) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(found).toBe(true);

    // L'auteur n'est pas prévenu de son propre geste.
    const own = await session.call("GET", "/api/alerts", { actor: "technician" });
    expect(JSON.stringify(own.body).includes(`Intervention démarrée — OT #${wo.id}`)).toBe(false);
  });
});
