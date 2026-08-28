import { db } from "../server/db";
import { vehicleDocuments, vehicles } from "../shared/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

type DateLike = string | Date | null | undefined;

const toDateOnly = (value: DateLike): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
};

type DocType = "carte_grise" | "assurance" | "visite_technique";
type VehicleDocDates = Partial<Record<DocType, string>>;

const isLaterDate = (a: string, b: string): boolean => a > b;

async function run(): Promise<void> {
  console.log("🔄 Backfill documents -> vehicles (master dates)...");

  const [allVehicles, allDocs] = await Promise.all([
    db
      .select({
        id: vehicles.id,
        licensePlateExpiry: vehicles.licensePlateExpiry,
        insuranceExpiry: vehicles.insuranceExpiry,
        technicalInspectionDate: vehicles.technicalInspectionDate,
      })
      .from(vehicles),
    db
      .select({
        vehicleId: vehicleDocuments.vehicleId,
        type: vehicleDocuments.type,
        expiryDate: vehicleDocuments.expiryDate,
      })
      .from(vehicleDocuments)
      .where(
        and(
          inArray(vehicleDocuments.type, ["carte_grise", "assurance", "visite_technique"]),
          isNotNull(vehicleDocuments.expiryDate),
        ),
      ),
  ]);

  const latestByVehicle = new Map<number, VehicleDocDates>();

  for (const row of allDocs) {
    if (!row.expiryDate) continue;
    const docType = row.type as DocType;
    if (!["carte_grise", "assurance", "visite_technique"].includes(docType)) continue;

    const nextDate = toDateOnly(row.expiryDate);
    if (!nextDate) continue;

    const current = latestByVehicle.get(row.vehicleId) || {};
    const currentDate = current[docType];
    if (!currentDate || isLaterDate(nextDate, currentDate)) {
      current[docType] = nextDate;
      latestByVehicle.set(row.vehicleId, current);
    }
  }

  let updatedCount = 0;

  for (const vehicle of allVehicles) {
    const latest = latestByVehicle.get(vehicle.id);
    if (!latest) continue;

    const patch: Partial<{
      licensePlateExpiry: string;
      insuranceExpiry: string;
      technicalInspectionDate: string;
    }> = {};

    if (latest.carte_grise && latest.carte_grise !== toDateOnly(vehicle.licensePlateExpiry)) {
      patch.licensePlateExpiry = latest.carte_grise;
    }
    if (latest.assurance && latest.assurance !== toDateOnly(vehicle.insuranceExpiry)) {
      patch.insuranceExpiry = latest.assurance;
    }
    if (
      latest.visite_technique &&
      latest.visite_technique !== toDateOnly(vehicle.technicalInspectionDate)
    ) {
      patch.technicalInspectionDate = latest.visite_technique;
    }

    if (Object.keys(patch).length === 0) continue;

    await db.update(vehicles).set(patch).where(eq(vehicles.id, vehicle.id));
    updatedCount += 1;
  }

  console.log(`✅ Backfill terminé: ${updatedCount} véhicule(s) synchronisé(s).`);
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Backfill error:", error);
    process.exit(1);
  });
