import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { clients, tariffGrid } from "@shared/schema";
import {
  periodsOverlap,
  pickTariff,
  type PricingUnit,
  type TariffBody,
  type TariffRow,
  type TariffSuggestion,
} from "@shared/contracts/tariff-grid";

const OVERLAP_MESSAGE = "Un tarif existe déjà pour ce client, ce trajet et ce type de marchandise sur une période qui chevauche celle-ci.";

type Stored = typeof tariffGrid.$inferSelect;

const toRow = (t: Stored, clientName: string | null): TariffRow => ({
  id: t.id,
  clientId: t.clientId,
  clientName,
  origin: t.origin,
  destination: t.destination,
  cargoType: t.cargoType,
  pricingUnit: t.pricingUnit as PricingUnit,
  unitPrice: Number(t.unitPrice),
  validFrom: t.validFrom,
  validTo: t.validTo,
  active: t.active,
  notes: t.notes,
});

export async function listTariffs(filter: { clientId?: number; activeOnly?: boolean }): Promise<TariffRow[]> {
  const conditions = [
    filter.clientId ? eq(tariffGrid.clientId, filter.clientId) : undefined,
    filter.activeOnly ? eq(tariffGrid.active, true) : undefined,
  ].filter((c) => c !== undefined);
  const rows = await db
    .select({ t: tariffGrid, clientName: clients.name })
    .from(tariffGrid)
    .leftJoin(clients, eq(clients.id, tariffGrid.clientId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(tariffGrid.origin, tariffGrid.destination, tariffGrid.cargoType, sql`${tariffGrid.validFrom} DESC`);
  return rows.map((r) => toRow(r.t, r.clientName));
}

async function assertClientExists(clientId: number | null | undefined) {
  if (!clientId) return;
  const [c] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
  if (!c) throw new AppError(400, "Client introuvable.");
}

const valuesOf = (body: TariffBody) => ({
  clientId: body.clientId ?? null,
  origin: body.origin,
  destination: body.destination,
  cargoType: body.cargoType ?? "",
  pricingUnit: body.pricingUnit,
  unitPrice: String(body.unitPrice),
  validFrom: body.validFrom,
  validTo: body.validTo ?? null,
  active: body.active ?? true,
  notes: body.notes ?? null,
});

function periodOrder(body: TariffBody) {
  if (body.validTo && body.validTo < body.validFrom) throw new AppError(400, "La fin de période précède son début.");
}

/** Refuse le chevauchement de périodes pour la même clé (client, trajet, marchandise). Appelé sous verrou. */
async function assertNoOverlap(tx: Pick<typeof db, "select">, body: TariffBody, ignoreId?: number) {
  if (body.active === false) return; // un tarif inactif ne bloque rien et n'est pas bloqué
  const same = await tx
    .select()
    .from(tariffGrid)
    .where(
      and(
        body.clientId ? eq(tariffGrid.clientId, body.clientId) : isNull(tariffGrid.clientId),
        sql`lower(${tariffGrid.origin}) = lower(${body.origin})`,
        sql`lower(${tariffGrid.destination}) = lower(${body.destination})`,
        sql`lower(${tariffGrid.cargoType}) = lower(${body.cargoType ?? ""})`,
        eq(tariffGrid.active, true),
        ignoreId ? ne(tariffGrid.id, ignoreId) : undefined,
      ),
    );
  const mine = { validFrom: body.validFrom, validTo: body.validTo ?? null };
  if (same.some((t) => periodsOverlap(mine, t))) throw new AppError(409, OVERLAP_MESSAGE);
}

/** Verrou par transaction : deux saisies concurrentes de la même grille ne passent pas la vérification ensemble. */
const lockGrid = (tx: { execute: typeof db.execute }) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tariff_grid'))`);

export async function createTariff(body: TariffBody, userId: number): Promise<TariffRow> {
  periodOrder(body);
  await assertClientExists(body.clientId);
  return db.transaction(async (tx) => {
    await lockGrid(tx);
    await assertNoOverlap(tx, body);
    const [row] = await tx.insert(tariffGrid).values({ ...valuesOf(body), createdBy: userId, updatedBy: userId }).returning();
    return toRow(row, null);
  });
}

export async function updateTariff(id: number, body: TariffBody, userId: number): Promise<TariffRow> {
  periodOrder(body);
  await assertClientExists(body.clientId);
  return db.transaction(async (tx) => {
    await lockGrid(tx);
    const [current] = await tx.select({ id: tariffGrid.id }).from(tariffGrid).where(eq(tariffGrid.id, id));
    if (!current) throw new AppError(404, "Tarif introuvable.");
    await assertNoOverlap(tx, body, id);
    const [row] = await tx
      .update(tariffGrid)
      .set({ ...valuesOf(body), updatedBy: userId, updatedAt: new Date() })
      .where(eq(tariffGrid.id, id))
      .returning();
    return toRow(row, null);
  });
}

/** Désactivation plutôt que suppression : l'historique des prix reste consultable. */
export async function deactivateTariff(id: number, userId: number): Promise<TariffRow> {
  const [row] = await db
    .update(tariffGrid)
    .set({ active: false, updatedBy: userId, updatedAt: new Date() })
    .where(eq(tariffGrid.id, id))
    .returning();
  if (!row) throw new AppError(404, "Tarif introuvable.");
  return toRow(row, null);
}

/** Lecture seule : propose un prix, n'écrit rien. */
export async function suggestTariff(query: {
  clientId?: number;
  origin: string;
  destination: string;
  cargoType?: string;
  date?: string;
}): Promise<TariffSuggestion> {
  // Jour calendaire de Douala, pas celui d'UTC : après 23h à Douala, UTC est déjà la veille.
  const date = query.date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Douala" }).format(new Date());
  const rows = await listTariffs({ activeOnly: true });
  return { suggestion: pickTariff(rows, { ...query, date }) };
}
