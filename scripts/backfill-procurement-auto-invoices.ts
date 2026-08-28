import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../server/db";
import { purchaseOrders, supplierInvoices } from "../shared/schema";
import { procurementService } from "../server/services/procurement-service";

const apply = process.argv.includes("--apply");
const statuses = ["delivered", "completed"] as const;

type CandidateOrder = {
  id: number;
  orderNumber: string;
  status: string;
};

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║   BACKFILL FACTURES AUTO (RÉCEPTION COMMANDES FOURNISSEUR)         ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");
  console.log(apply ? "Mode: APPLY (écrit en base)" : "Mode: DRY-RUN (aucune écriture)");

  const deliveredOrders = await db
    .select({
      id: purchaseOrders.id,
      orderNumber: purchaseOrders.orderNumber,
      status: purchaseOrders.status,
    })
    .from(purchaseOrders)
    .where(inArray(purchaseOrders.status, [...statuses]));

  const candidates: CandidateOrder[] = [];
  let alreadyOk = 0;

  for (const order of deliveredOrders) {
    const [existingInvoice] = await db
      .select({
        id: supplierInvoices.id,
        invoiceNumber: supplierInvoices.invoiceNumber,
      })
      .from(supplierInvoices)
      .where(eq(supplierInvoices.purchaseOrderId, order.id))
      .limit(1);

    if (existingInvoice) {
      alreadyOk += 1;
      continue;
    }

    candidates.push(order);
  }

  console.log(`Commandes réceptionnées analysées: ${deliveredOrders.length}`);
  console.log(`Commandes déjà avec facture liée: ${alreadyOk}`);
  console.log(`Commandes à corriger: ${candidates.length}`);

  if (candidates.length > 0) {
    console.log("\nAperçu:");
    for (const candidate of candidates.slice(0, 20)) {
      console.log(`- PO#${candidate.id} (${candidate.orderNumber}) [${candidate.status}]`);
    }
  }

  if (!apply) {
    console.log("\n✅ Dry-run terminé. Relancer avec --apply pour appliquer.");
    return;
  }

  let created = 0;
  for (const candidate of candidates) {
    const result = await procurementService.ensureSupplierInvoiceGenerated(candidate.id);
    if (result.created) {
      created += 1;
      console.log(`🧾 Facture créée pour PO#${candidate.id}: ${result.invoiceNumber || "N/A"}`);
    }
  }

  console.log("\n✅ Backfill appliqué.");
  console.log(`Factures créées: ${created}`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("❌ Erreur backfill factures auto:", error);
    await pool.end();
    process.exit(1);
  });
