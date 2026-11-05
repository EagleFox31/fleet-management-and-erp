import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { clients, tariffGrid } from "@shared/schema";
import {
  periodsOverlap,
  pickTariff,
  type PricingUnit,
  TARIFF_PAGE_SIZE_DEFAULT,
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

type TariffFilter = { clientId?: number; activeOnly?: boolean };

const whereOf = (filter: TariffFilter) => {
  const conditions = [
    filter.clientId ? eq(tariffGrid.clientId, filter.clientId) : undefined,
    filter.activeOnly ? eq(tariffGrid.active, true) : undefined,
  ].filter((c) => c !== undefined);
  return conditions.length ? and(...conditions) : undefined;
};

/** Ordre total (id en dernier départage) : deux pages ne se chevauchent ni ne sautent de ligne. */
const orderOf = () => [tariffGrid.origin, tariffGrid.destination, tariffGrid.cargoType, sql`${tariffGrid.validFrom} DESC`, tariffGrid.id] as const;

/** Toutes les lignes du filtre : réservé à la suggestion, qui doit voir toute la grille active. */
export async function listTariffs(filter: TariffFilter): Promise<TariffRow[]> {
  const rows = await db
    .select({ t: tariffGrid, clientName: clients.name })
    .from(tariffGrid)
    .leftJoin(clients, eq(clients.id, tariffGrid.clientId))
    .where(whereOf(filter))
    .orderBy(...orderOf());
  return rows.map((r) => toRow(r.t, r.clientName));
}

/** Une page de la liste, avec le total du filtre. */
export async function listTariffPage(
  filter: TariffFilter,
  page: { limit?: number; offset?: number },
): Promise<{ rows: TariffRow[]; total: number; limit: number; offset: number }> {
  const limit = page.limit ?? TARIFF_PAGE_SIZE_DEFAULT;
  const offset = page.offset ?? 0;
  const [rows, [count]] = await Promise.all([
    db
      .select({ t: tariffGrid, clientName: clients.name })
      .from(tariffGrid)
      .leftJoin(clients, eq(clients.id, tariffGrid.clientId))
      .where(whereOf(filter))
      .orderBy(...orderOf())
      .limit(limit)
      .offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(tariffGrid).where(whereOf(filter)),
  ]);
  return { rows: rows.map((r) => toRow(r.t, r.clientName)), total: count?.n ?? 0, limit, offset };
}

/** Nom du client d'un tarif (null pour un tarif générique) : les réponses d'écriture le portent comme la liste. */
async function clientNameOf(clientId: number | null): Promise<string | null> {
  if (!clientId) return null;
  const [c] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId));
  return c?.name ?? null;
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
    return toRow(row, await clientNameOf(row.clientId));
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
    return toRow(row, await clientNameOf(row.clientId));
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
  return toRow(row, await clientNameOf(row.clientId));
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
