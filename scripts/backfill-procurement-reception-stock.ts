import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import {
  parts,
  partsStockMovements,
  purchaseOrderLines,
  purchaseOrders,
} from "../shared/schema";

type OrderLineRow = {
  orderId: number;
  orderNumber: string;
  orderStatus: string;
  orderCreatedBy: number | null;
  lineId: number;
  partId: number;
  partRequirementId: number | null;
  quantityOrdered: number;
  quantityReceived: number;
};

type Group = {
  orderId: number;
  orderNumber: string;
  orderStatus: string;
  orderCreatedBy: number | null;
  partId: number;
  expectedQty: number;
  lineIds: number[];
  requirementIds: number[];
};

type BackfillAction = {
  orderId: number;
  orderNumber: string;
  partId: number;
  expectedQty: number;
  alreadyCreditedQty: number;
  missingQty: number;
};

const apply = process.argv.includes("--apply");

const deliveredStatuses = ["delivered", "completed"] as const;

function asInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildGroups(rows: OrderLineRow[]): Group[] {
  const grouped = new Map<string, Group>();

  for (const row of rows) {
    const key = `${row.orderId}:${row.partId}`;
    const existing = grouped.get(key);
    const expectedForLine = Math.max(row.quantityOrdered || 0, row.quantityReceived || 0);

    if (!existing) {
      grouped.set(key, {
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        orderStatus: row.orderStatus,
        orderCreatedBy: row.orderCreatedBy,
        partId: row.partId,
        expectedQty: expectedForLine,
        lineIds: [row.lineId],
        requirementIds: row.partRequirementId ? [row.partRequirementId] : [],
      });
      continue;
    }

    existing.expectedQty += expectedForLine;
    existing.lineIds.push(row.lineId);
    if (row.partRequirementId && !existing.requirementIds.includes(row.partRequirementId)) {
      existing.requirementIds.push(row.partRequirementId);
    }
  }

  return Array.from(grouped.values()).sort((a, b) => a.orderId - b.orderId || a.partId - b.partId);
}

async function getOrderCreditedQty(orderId: number, partId: number): Promise<number> {
  const result = await db
    .select({
      qty: sql<number>`COALESCE(SUM(${partsStockMovements.quantity}), 0)::int`,
    })
    .from(partsStockMovements)
    .where(
      and(
        eq(partsStockMovements.partId, partId),
        eq(partsStockMovements.movementType, "in"),
        or(
          sql`${partsStockMovements.reason} ILIKE ${`Réception commande #${orderId}%`}`,
          sql`${partsStockMovements.notes} ILIKE ${`%[BACKFILL_PO_RECEIPT] order=${orderId} part=${partId}%`}`,
        ),
      ),
    );

  return asInt(result[0]?.qty);
}

async function getRequirementCreditedQty(partId: number, requirementIds: number[]): Promise<number> {
  if (requirementIds.length === 0) return 0;

  const reasonMatchers = requirementIds.flatMap((id) => [
    sql`${partsStockMovements.reason} ILIKE ${`Réception demande #${id}%`}`,
    sql`${partsStockMovements.reason} ILIKE ${`Réception partielle demande #${id}%`}`,
  ]);

  const result = await db
    .select({
      qty: sql<number>`COALESCE(SUM(${partsStockMovements.quantity}), 0)::int`,
    })
    .from(partsStockMovements)
    .where(
      and(
        eq(partsStockMovements.partId, partId),
        eq(partsStockMovements.movementType, "in"),
        or(...reasonMatchers),
      ),
    );

  return asInt(result[0]?.qty);
}

async function applyBackfillAction(action: BackfillAction, createdBy: number | null): Promise<void> {
  const [currentPart] = await db
    .select({ quantity: parts.quantity })
    .from(parts)
    .where(eq(parts.id, action.partId))
    .limit(1);

  if (!currentPart) {
    console.warn(`⚠️ Pièce #${action.partId} introuvable, action ignorée`);
    return;
  }

  const previousStock = currentPart.quantity || 0;
  const newStock = previousStock + action.missingQty;

  await db
    .update(parts)
    .set({ quantity: newStock })
    .where(eq(parts.id, action.partId));

  await db.insert(partsStockMovements).values({
    partId: action.partId,
    movementType: "in",
    quantity: action.missingQty,
    previousStock,
    newStock,
    reason: `Réception commande #${action.orderId} (backfill)`,
    notes: `[BACKFILL_PO_RECEIPT] order=${action.orderId} part=${action.partId} expected=${action.expectedQty} alreadyCredited=${action.alreadyCreditedQty}`,
    createdBy: createdBy ?? undefined,
  });
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║   BACKFILL STOCK RÉCEPTION COMMANDES FOURNISSEUR (P3)              ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");
  console.log(apply ? "Mode: APPLY (écrit en base)" : "Mode: DRY-RUN (aucune écriture)");

  const rowsRaw = await db
    .select({
      orderId: purchaseOrders.id,
      orderNumber: purchaseOrders.orderNumber,
      orderStatus: purchaseOrders.status,
      orderCreatedBy: purchaseOrders.createdBy,
      lineId: purchaseOrderLines.id,
      partId: purchaseOrderLines.partId,
      partRequirementId: purchaseOrderLines.partRequirementId,
      quantityOrdered: purchaseOrderLines.quantityOrdered,
      quantityReceived: purchaseOrderLines.quantityReceived,
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
    .where(
      and(
        inArray(purchaseOrders.status, [...deliveredStatuses]),
        sql`${purchaseOrderLines.partId} IS NOT NULL`,
      ),
    );

  const rows: OrderLineRow[] = rowsRaw
    .filter((row) => typeof row.partId === "number")
    .map((row) => ({
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      orderStatus: row.orderStatus,
      orderCreatedBy: row.orderCreatedBy,
      lineId: row.lineId,
      partId: row.partId as number,
      partRequirementId: row.partRequirementId,
      quantityOrdered: row.quantityOrdered || 0,
      quantityReceived: row.quantityReceived || 0,
    }));

  const groups = buildGroups(rows);
  console.log(`Commandes réceptionnées analysées: ${new Set(groups.map((g) => g.orderId)).size}`);
  console.log(`Groupes commande+pièce analysés: ${groups.length}`);

  const actions: BackfillAction[] = [];
  let alreadyOk = 0;

  for (const group of groups) {
    const orderCreditedQty = await getOrderCreditedQty(group.orderId, group.partId);
    const requirementCreditedQty = await getRequirementCreditedQty(group.partId, group.requirementIds);
    const alreadyCreditedQty = orderCreditedQty + requirementCreditedQty;
    const missingQty = Math.max(0, group.expectedQty - alreadyCreditedQty);

    if (missingQty <= 0) {
      alreadyOk += 1;
      continue;
    }

    actions.push({
      orderId: group.orderId,
      orderNumber: group.orderNumber,
      partId: group.partId,
      expectedQty: group.expectedQty,
      alreadyCreditedQty,
      missingQty,
    });
  }

  const totalQtyToAdd = actions.reduce((sum, action) => sum + action.missingQty, 0);
  console.log(`Groupes déjà cohérents: ${alreadyOk}`);
  console.log(`Groupes à corriger: ${actions.length}`);
  console.log(`Quantité totale à ajouter: +${totalQtyToAdd}`);

  if (actions.length > 0) {
    console.log("\nAperçu (max 20 lignes):");
    for (const action of actions.slice(0, 20)) {
      console.log(
        `- PO#${action.orderId} (${action.orderNumber}) / part#${action.partId} : expected=${action.expectedQty}, credited=${action.alreadyCreditedQty}, missing=+${action.missingQty}`,
      );
    }
  }

  if (!apply) {
    console.log("\n✅ Dry-run terminé. Relancer avec --apply pour appliquer.");
    return;
  }

  for (const action of actions) {
    const group = groups.find((g) => g.orderId === action.orderId && g.partId === action.partId);
    await applyBackfillAction(action, group?.orderCreatedBy ?? null);
  }

  console.log("\n✅ Backfill appliqué.");
  console.log(`Mouvements créés: ${actions.length}`);
  console.log(`Quantité totale ajoutée: +${totalQtyToAdd}`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("❌ Erreur backfill réception commandes:", error);
    await pool.end();
    process.exit(1);
  });

