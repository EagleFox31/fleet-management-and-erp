import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions, vehicleDocuments } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { apiErrorProblems } from "../support/api-error";
import { startContractSession } from "../support/contract-session";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Lancement refusé faute de budget : le 400 passe par AppError (code, requestId) et son message dit
 * au chauffeur quoi faire (« Contactez l'exploitation »), sans détail technique. Le personnel voit les
 * mêmes motifs, sans la consigne de s'adresser à lui-même. Le message reste sous 300 caractères (sinon le
 * contrat d'erreur le remplace par un libellé générique) : les motifs en trop sont comptés, pas listés.
 */
type Actor = "driver" | "logistics";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const missionIds: number[] = [];
const driverIds: number[] = [];
const ids = createIdBag();

async function launchableMissionWithoutBudget() {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  if (driverIds.length === 0) {
    const [d] = await db
      .insert(drivers)
      .values({ firstName: "TEST", lastName: uniqueTestToken("drv"), userId: session.userId("driver"), isActive: true } as any)
      .returning();
    driverIds.push(d.id);
  }
  const d = { id: driverIds[0] };
  const [m] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("MLD"), pickupAddress: "A", deliveryAddress: "B", status: "assigned" } as any)
    .returning();
  missionIds.push(m.id);
  await db.insert(assignments).values({ missionId: m.id, vehicleId: v.id, driverId: d.id, status: "accepted" } as any);
  return m.id;
}

beforeAll(async () => {
  session = await startContractSession<Actor>({ driver: "driver", logistics: "logistics" });
}, 60000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
});

describe("PUT /api/missions/:id/status vers in_progress sans budget", { timeout: 60000 }, () => {
  it("chauffeur : 400 lisible, motif du budget et consigne de contacter l'exploitation", async () => {
    const id = await launchableMissionWithoutBudget();
    const res = await session.call("PUT", `/api/missions/${id}/status`, { actor: "driver", body: { status: "in_progress" } });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.message).toContain("Budget carburant non renseigné");
    expect(res.body.message).toContain("Contactez l'exploitation");
    expect(res.body.message.length).toBeLessThanOrEqual(300);
    expect(apiErrorProblems(res.status, res.body, 400)).toEqual([]);
  });

  it("personnel : mêmes motifs, sans la consigne", async () => {
    const id = await launchableMissionWithoutBudget();
    const res = await session.call("PUT", `/api/missions/${id}/status`, { actor: "logistics", body: { status: "in_progress" } });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.message).toContain("Budget carburant non renseigné");
    expect(res.body.message).not.toContain("Contactez l'exploitation");
    expect(res.body.message.length).toBeLessThanOrEqual(300);
  });
});

/**
 * Garde-fou #354 / #466 : le message est borné et tait les motifs en trop, or l'écran tire de la
 * liste complète l'action « Créer demande de renouvellement » (document manquant ou expiré). La liste
 * complète voyage dans `motifs`, à la racine du corps (AppError details fusionnés par le gestionnaire central).
 * Retirer `details` de la levée dans missions.routes.ts rend ce test rouge.
 */
describe("PUT /api/missions/:id/status : liste complète des motifs de refus", { timeout: 60000 }, () => {
  it("un motif de document tu par la borne du message reste dans body.motifs", async () => {
    const id = await launchableMissionWithoutBudget();
    const [assignment] = await db.select().from(assignments).where(inArray(assignments.missionId, [id]));
    await db.insert(vehicleDocuments).values({
      vehicleId: assignment.vehicleId,
      name: "Assurance périmée",
      type: "assurance",
      filename: "assurance.pdf",
      filesize: 1,
      fileType: "application/pdf",
      filePath: "uploads/test-assurance.pdf",
      expiryDate: new Date("2020-01-01T00:00:00Z"),
    } as any);

    const res = await session.call("PUT", `/api/missions/${id}/status`, { actor: "logistics", body: { status: "in_progress" } });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    // Borne du contrat d'erreur : 300 (la borne de 240 des motifs exclut le suffixe « et N autres points »).
    expect(res.body.message.length).toBeLessThanOrEqual(300);
    expect(Array.isArray(res.body.motifs), JSON.stringify(res.body)).toBe(true);
    expect(res.body.motifs).toContain("Assurance manquante ou expirée.");
    // Le scénario ne prouve rien si le message contient déjà le motif : il doit avoir été tu.
    expect(res.body.message).not.toContain("Assurance manquante ou expirée.");
    expect(res.body.motifs.length).toBeGreaterThan(1);
  });
});
