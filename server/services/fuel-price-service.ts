import { desc, lte } from "drizzle-orm";
import {
  DEFAULT_FUEL_PRICE_PER_LITER,
  type CreateFuelPriceRequest,
  type FuelPrice,
} from "@shared/contracts/fuel-prices";
import { fuelPrices, type FuelPriceRow } from "@shared/schema";
import { db } from "../db";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("fuel-prices");

function toFuelPrice(row: FuelPriceRow): FuelPrice {
  return {
    effectiveFrom: row.effectiveFrom,
    pricePerLiter: Number(row.pricePerLiter),
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}

export function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Tous les prix, du plus récent au plus ancien. */
export async function listFuelPrices(): Promise<FuelPrice[]> {
  const rows = await db.select().from(fuelPrices).orderBy(desc(fuelPrices.effectiveFrom));
  return rows.map(toFuelPrice);
}

/**
 * Prix du litre applicable à `date` : le dernier dont la date d'effet précède ou égale la date.
 * Lecture unique pour tout le serveur (remplace les 828 en dur). Repli sur le défaut du contrat
 * si la table est vide ou illisible : un calcul de carburant ne doit pas tomber pour un prix.
 */
export async function getFuelPriceAt(date: string = todayIsoDate()): Promise<number> {
  try {
    const [row] = await db
      .select()
      .from(fuelPrices)
      .where(lte(fuelPrices.effectiveFrom, date))
      .orderBy(desc(fuelPrices.effectiveFrom))
      .limit(1);
    return row ? Number(row.pricePerLiter) : DEFAULT_FUEL_PRICE_PER_LITER;
  } catch (err) {
    log.error({ err, date }, "prix du carburant illisible, prix par défaut utilisé");
    return DEFAULT_FUEL_PRICE_PER_LITER;
  }
}

/** Pose le prix d'une date d'effet ; une seconde saisie à la même date le corrige (idempotent). */
export async function setFuelPrice(userId: number, input: CreateFuelPriceRequest): Promise<FuelPrice> {
  const [row] = await db
    .insert(fuelPrices)
    .values({ effectiveFrom: input.effectiveFrom, pricePerLiter: String(input.pricePerLiter), createdBy: userId })
    .onConflictDoUpdate({
      target: fuelPrices.effectiveFrom,
      set: { pricePerLiter: String(input.pricePerLiter), createdBy: userId },
    })
    .returning();
  return toFuelPrice(row);
}
