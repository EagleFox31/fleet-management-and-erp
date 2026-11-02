import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { excelExportService } from "../services/excel-export-service";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { requireFeature } from "../lib/feature-flags";
import { reportMimeType } from "../lib/report-export";
import { kpiReportService } from "../services/kpi-report-service";
import { kpiReportQuerySchema } from "@shared/contracts/exports";

/**
 * Exports Excel. Les gardes (session, role par EXPORT_ROLE_MATRIX, drapeau
 * `exports`) sont posees au montage dans server/api/index.ts (exportsGuard) :
 * une route ajoutee ici est donc refusee tant qu'elle n'est pas dans la matrice.
 */
const router = Router();
const log = moduleLogger("exports");

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const today = () => new Date().toISOString().split("T")[0];

/** Nom de fichier sur : lettres, chiffres, tiret et souligne ; rien qui puisse casser l'en-tete. */
function safeName(value: string): string {
  const cleaned = value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 60) || "export";
}

const yearSchema = z.coerce.number().int().min(2000).max(2100);
const monthSchema = z.coerce.number().int().min(1).max(12);
const optionalText = z.string().trim().max(120).optional();

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, message, { cause: result.error });
  return result.data;
}

function sendXlsx(res: Response, buffer: Buffer | ArrayBuffer | Uint8Array, filename: string) {
  res.setHeader("Content-Type", XLSX_MIME);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
  res.send(buffer);
}

type Handler = (req: Request, res: Response) => Promise<void>;

function route(path: string, label: string, handler: Handler, ...guards: RequestHandler[]) {
  router.get(path, ...guards, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof AppError) return next(error);
      log.error({ err: error, requestId: req.requestId, path }, `Echec de l'export ${label}`);
      next(new AppError(500, `Impossible de generer l'export ${label}.`, { cause: error }));
    }
  });
}

route("/supplier-invoices", "des factures fournisseurs", async (_req, res) => {
  sendXlsx(res, await excelExportService.exportSupplierInvoices(), `factures_fournisseurs_${today()}`);
});

route("/inventory", "de l'inventaire", async (_req, res) => {
  sendXlsx(res, await excelExportService.exportInventory(), `inventaire_stock_${today()}`);
});

async function fuelExport(req: Request, res: Response, prefix: string) {
  const year = parse(yearSchema, req.query.year, "L'annee est requise (ex. 2026).");
  const month = req.query.month === undefined ? undefined : parse(monthSchema, req.query.month, "Le mois doit etre compris entre 1 et 12.");
  const buffer = await excelExportService.exportFuelConsumption(year, month);
  sendXlsx(res, buffer, month ? `${prefix}_${month}_${year}` : `${prefix}_${year}`);
}

route("/fuel-consumption", "de la consommation carburant", (req, res) => fuelExport(req, res, "carburant"));
route("/fuel-statistics", "des statistiques carburant", (req, res) => fuelExport(req, res, "stats_carburant"));

route("/client-operations", "des operations clients", async (req, res) => {
  const clientName = parse(optionalText, req.query.clientName, "Nom de client invalide.");
  const name = clientName ? `operations_${safeName(clientName)}_${today()}` : `operations_${today()}`;
  sendXlsx(res, await excelExportService.exportClientOperations(clientName), name);
});

// Alias de client-operations (parametre historique `client`).
route("/client-missions", "des missions clients", async (req, res) => {
  const client = parse(optionalText, req.query.client, "Nom de client invalide.");
  const name = client ? `missions_${safeName(client)}_${today()}` : `missions_tous_clients_${today()}`;
  sendXlsx(res, await excelExportService.exportClientOperations(client), name);
});

route("/client-invoices", "des factures clients", async (req, res) => {
  const clientName = parse(optionalText, req.query.clientName, "Nom de client invalide.");
  const name = clientName ? `factures_${safeName(clientName)}_${today()}` : `factures_clients_${today()}`;
  sendXlsx(res, await excelExportService.exportClientInvoices(clientName), name);
});

route("/monthly-report", "du rapport mensuel", async (req, res) => {
  const year = parse(yearSchema, req.query.year, "L'annee est requise (ex. 2026).");
  const month = parse(monthSchema, req.query.month, "Le mois est requis (1 a 12).");
  sendXlsx(res, await excelExportService.exportMonthlyAccountingReport(year, month), `rapport_mensuel_${month}_${year}`);
});

/**
 * Rapport des indicateurs de pilotage (CDC #7). Rôles : `KPI_VIEWER_ROLES` (matrice d'exports,
 * posée au montage) ; drapeau `kpi-reports` en plus du drapeau `exports`.
 */
route(
  "/kpi-report",
  "du rapport des indicateurs",
  async (req, res) => {
    const query = parse(kpiReportQuerySchema, req.query, "Paramètres du rapport invalides (période, dates ou format).");
    const { buffer, filename } = await kpiReportService.render(query, query.format);
    res.setHeader("Content-Type", reportMimeType(query.format));
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.${query.format}"`);
    res.send(buffer);
  },
  requireFeature("kpi-reports"),
);

export default router;
