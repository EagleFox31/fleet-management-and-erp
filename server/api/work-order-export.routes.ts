import { Router, type RequestHandler } from "express";
import { eq } from "drizzle-orm";
import {
  DOCX_CONTENT_TYPE,
  workOrderExportParamsSchema,
  workOrderExportQuerySchema,
} from "@shared/contracts/work-order-export";
import { getWorkOrderItemStatusLabel } from "@shared/constants/work-order-items";
import { parts, partsUsed, users, vehicles } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { requireFeature } from "../lib/feature-flags";
import { buildWorkOrderDocx, workOrderDocFilename, type WorkOrderDocData } from "../lib/word";
import { authenticate, isStockIssuer, isTechnician } from "../middleware/auth";
import { workOrderItemsService } from "../services/work-order-items-service";
import { storage } from "../storage";

/** Libellés d'état de l'OT lui-même (pas des lignes de travail). */
const STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  in_progress: "En cours",
  awaiting_parts: "En attente de pièces",
  completed: "Terminé",
  cancelled: "Annulé",
};
const PRIORITY_LABELS: Record<string, string> = { low: "Basse", medium: "Moyenne", high: "Haute", critical: "Critique" };

const toNumber = (value: string | number | null | undefined) => (value == null ? null : Number(value));

async function loadDocData(
  workOrder: NonNullable<Awaited<ReturnType<typeof storage.getWorkOrder>>>,
  generatedByName: string | null,
): Promise<WorkOrderDocData> {
  const workOrderId = workOrder.id;
  const [[vehicle], [technician], itemsResult, partRows] = await Promise.all([
    db
      .select({ registration: vehicles.registrationNumber, brand: vehicles.brand, model: vehicles.model })
      .from(vehicles)
      .where(eq(vehicles.id, workOrder.vehicleId)),
    workOrder.technicianId
      ? db.select({ name: users.name }).from(users).where(eq(users.id, workOrder.technicianId))
      : Promise.resolve([] as { name: string }[]),
    workOrderItemsService.getItemsForWorkOrder(workOrderId),
    db
      .select({ reference: parts.reference, name: parts.name, quantity: partsUsed.quantity, unitPrice: partsUsed.unitPrice })
      .from(partsUsed)
      .innerJoin(parts, eq(partsUsed.partId, parts.id))
      .where(eq(partsUsed.workOrderId, workOrderId)),
  ]);

  return {
    id: workOrder.id,
    title: workOrder.title,
    description: workOrder.description,
    diagnosis: workOrder.diagnosis,
    statusLabel: STATUS_LABELS[workOrder.status] ?? workOrder.status,
    priorityLabel: PRIORITY_LABELS[workOrder.priority] ?? workOrder.priority,
    vehicle: vehicle ?? {},
    technicianName: technician?.name ?? null,
    startDate: workOrder.startDate ?? null,
    endDate: workOrder.endDate ?? null,
    lines: itemsResult.items.map((item) => ({
      label: item.customLabel || item.laborCatalogLabel || "Travail",
      technicianName: item.technicianName,
      estimatedHours: toNumber(item.estimatedHours),
      actualHours: toNumber(item.actualHours),
      status: getWorkOrderItemStatusLabel(item.status),
      notes: item.notes,
    })),
    parts: partRows.map((row) => ({ ...row, unitPrice: toNumber(row.unitPrice) })),
    generatedAt: new Date(),
    generatedByName,
  };
}

/** Garde par document : l'OT pour l'atelier, le bon de sortie pour qui sort du stock. */
const guardByDoc: RequestHandler = (req, res, next) => {
  const query = workOrderExportQuerySchema.safeParse(req.query);
  if (!query.success) return next(query.error);
  return (query.data.doc === "bon-sortie" ? isStockIssuer : isTechnician)(req, res, next);
};

const exportWorkOrder: RequestHandler = async (req, res, next) => {
  try {
    const { id } = workOrderExportParamsSchema.parse(req.params);
    const { doc } = workOrderExportQuerySchema.parse(req.query);

    const workOrder = await storage.getWorkOrder(id);
    if (!workOrder) throw new AppError(404, "Ordre de travail introuvable.");

    // Un technicien ne télécharge que ses OT (même règle que work-order-items.routes.ts).
    if (req.user?.role === "technician" && workOrder.technicianId && workOrder.technicianId !== req.user.id) {
      throw new AppError(403, "Cet ordre de travail est assigné à un autre technicien.");
    }

    const [author] = await db.select({ name: users.name }).from(users).where(eq(users.id, req.user!.id));
    const data = await loadDocData(workOrder, author?.name ?? null);

    const buffer = await buildWorkOrderDocx(doc, data);
    res.status(200);
    res.setHeader("Content-Type", DOCX_CONTENT_TYPE);
    res.setHeader("Content-Disposition", `attachment; filename="${workOrderDocFilename(doc, id)}"`);
    res.setHeader("Content-Length", String(buffer.length));
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

const router = Router();
router.get("/work-orders/:id/export", requireFeature("exports"), authenticate, guardByDoc, exportWorkOrder);

export default router;
