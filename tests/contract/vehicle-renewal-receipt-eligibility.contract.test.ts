import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { documentRenewalRequests, vehicleDocuments } from "../../shared/schema";
import { getMissionEligibility } from "../../shared/constants/vehicle-eligibility";
import { loadOpenRenewalReceipts } from "../../server/lib/renewal-receipts";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";

/**
 * P3-2 lot 2b : un récépissé valide lève le blocage d'un papier échu jusqu'à sa date incluse,
 * via la source unique `getMissionEligibility` alimentée par les demandes ouvertes en base.
 * L'horloge est injectée, construite par composantes locales : le résultat ne dépend pas du
 * fuseau de la machine.
 */

const ids = createIdBag();
const JOUR_J = new Date(2026, 10, 3, 12, 0, 0); // 3 novembre 2026, midi local
const LENDEMAIN = new Date(2026, 10, 4, 12, 0, 0);
const ECHEANCE = "2026-10-01";

type Status = "pending" | "in_progress" | "completed" | "rejected";

async function vehicleWithExpiredInsurance() {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const [document] = await db
    .insert(vehicleDocuments)
    .values({ vehicleId: vehicle.id, name: "TEST assurance", type: "assurance", filename: "t.pdf", filesize: 1, fileType: "application/pdf", filePath: "uploads/test-inexistant.pdf", expiryDate: ECHEANCE })
    .returning();
  return { vehicle, document };
}

async function addRequest(
  vehicleId: number,
  vehicleDocumentId: number,
  options: { status?: Status; validUntil?: string; documentType?: "assurance" | "visite_technique" } = {},
) {
  await db.insert(documentRenewalRequests).values({
    vehicleId,
    vehicleDocumentId,
    documentType: options.documentType ?? "assurance",
    status: options.status ?? "pending",
    ...(options.validUntil
      ? {
          receiptValidUntil: options.validUntil,
          receiptFileName: "recepisse.pdf",
          receiptFilePath: "uploads/document-renewals/receipts/test-inexistant.pdf",
          receiptUploadedAt: new Date(),
        }
      : {}),
  });
}

async function eligibilityAt(vehicleId: number, today: Date) {
  const receipts = await loadOpenRenewalReceipts(vehicleId);
  return getMissionEligibility({ status: "operational", insuranceExpiry: ECHEANCE, receipts }, today);
}

afterAll(async () => {
  await cleanupCreated(ids);
});

describe("éligibilité et récépissé de renouvellement", { timeout: 120000 }, () => {
  beforeAll(() => {
    // Le fuseau de la machine ne doit rien changer : l'horloge est locale par construction.
    expect(JOUR_J.getDate()).toBe(3);
  });

  it("papier échu sans demande : refusé", async () => {
    const { vehicle } = await vehicleWithExpiredInsurance();
    const result = await eligibilityAt(vehicle.id, JOUR_J);
    expect(result.eligible).toBe(false);
    expect(result.blockers.map((b) => b.code)).toEqual(["insurance"]);
  });

  it("demande en cours sans récépissé : toujours refusé", async () => {
    const { vehicle, document } = await vehicleWithExpiredInsurance();
    await addRequest(vehicle.id, document.id, { status: "in_progress" });
    expect((await eligibilityAt(vehicle.id, JOUR_J)).eligible).toBe(false);
  });

  it("récépissé valide : éligible", async () => {
    const { vehicle, document } = await vehicleWithExpiredInsurance();
    await addRequest(vehicle.id, document.id, { validUntil: "2026-11-20" });
    expect((await eligibilityAt(vehicle.id, JOUR_J)).eligible).toBe(true);
  });

  it("au jour de validité du récépissé : éligible (date incluse) ; le lendemain : refusé", async () => {
    const { vehicle, document } = await vehicleWithExpiredInsurance();
    await addRequest(vehicle.id, document.id, { validUntil: "2026-11-03" });
    expect((await eligibilityAt(vehicle.id, JOUR_J)).eligible).toBe(true);
    const lendemain = await eligibilityAt(vehicle.id, LENDEMAIN);
    expect(lendemain.eligible).toBe(false);
    expect(lendemain.blockers.map((b) => b.code)).toEqual(["insurance"]);
  });

  it("le récépissé d'un autre papier, ou d'une demande terminée ou rejetée, ne lève rien", async () => {
    const { vehicle, document } = await vehicleWithExpiredInsurance();
    await addRequest(vehicle.id, document.id, { validUntil: "2026-11-20", documentType: "visite_technique" });
    await addRequest(vehicle.id, document.id, { validUntil: "2026-11-20", status: "completed" });
    await addRequest(vehicle.id, document.id, { validUntil: "2026-11-20", status: "rejected" });
    expect((await eligibilityAt(vehicle.id, JOUR_J)).eligible).toBe(false);
  });

  it("le récépissé ne lève pas l'état mécanique", async () => {
    const { vehicle, document } = await vehicleWithExpiredInsurance();
    await addRequest(vehicle.id, document.id, { validUntil: "2026-11-20" });
    const receipts = await loadOpenRenewalReceipts(vehicle.id);
    const result = getMissionEligibility({ status: "maintenance", insuranceExpiry: ECHEANCE, receipts }, JOUR_J);
    expect(result.blockers.map((b) => b.code)).toEqual(["maintenance"]);
  });
});
