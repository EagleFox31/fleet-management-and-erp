/**
 * Récapitulatif annuel des factures fournisseurs : HT, TVA, TTC et reste dû, par fournisseur et par mois.
 *
 * - Factures retenues : `invoice_date` dans l'année demandée (1er janvier au 31 décembre inclus),
 *   tous statuts (il n'existe pas de statut annulé). Les factures en litige (`disputed`) sont comptées
 *   et isolées en plus dans `disputedCount` / `disputedAmountTtc`.
 * - Colonnes en double dans le schéma : TTC = `total_ttc`, sinon `total_amount`, sinon HT + TVA ;
 *   TVA = `vat_amount`, sinon `tax_amount`, sinon TTC − HT si un TTC est renseigné, sinon 0.
 *   Ainsi HT + TVA = TTC sur chaque facture dont la TVA n'est pas saisie.
 * - Mois, fournisseurs et totaux sont calculés à partir d'une seule lecture : ils sont cohérents entre eux.
 * - `outstandingAsOfToday` : reste dû actuel (`balance`) à la date de lecture, pas un solde historique
 *   de l'année. La variante « TTC moins les règlements de l'année » n'est pas couverte ici.
 * - Par défaut, `year` vaut l'année en cours à Africa/Douala. `supplierId` absent ou vide : tous.
 * Lecture seule. Rôles : ceux de la lecture des factures fournisseurs.
 */
import { z } from "zod";
import { MAX_DB_INTEGER_ID } from "./common";
import { KPI_MAX_YEAR, KPI_MIN_YEAR } from "./kpi-period";

export const SUPPLIER_ANNUAL_RECAP_PATH = "/api/supplier-invoices/annual-recap";

export const supplierAnnualRecapQuerySchema = z
  .object({
    year: z
      .string()
      .regex(/^\d{4}$/, "Année attendue au format AAAA.")
      .refine((v) => Number(v) >= KPI_MIN_YEAR && Number(v) <= KPI_MAX_YEAR, `Année attendue entre ${KPI_MIN_YEAR} et ${KPI_MAX_YEAR}.`)
      .optional(),
    /** Lu strictement par le serveur (`parseQueryId`) : vide = tous les fournisseurs. */
    supplierId: z.string().optional(),
  })
  .strict();

const id = z.number().int().positive().max(MAX_DB_INTEGER_ID);
const fcfa = z.number();

export const supplierRecapAmountsSchema = z.object({
  count: z.number().int().min(0),
  amountHt: fcfa,
  vatAmount: fcfa,
  amountTtc: fcfa,
  /** Reste dû actuel (`balance`), pas un solde historique de l'année. */
  outstandingAsOfToday: fcfa,
  disputedCount: z.number().int().min(0),
  disputedAmountTtc: fcfa,
});

const monthSchema = supplierRecapAmountsSchema.extend({ month: z.number().int().min(1).max(12) });

export const supplierAnnualRecapResponseSchema = z.object({
  year: z.number().int(),
  supplierId: id.nullable(),
  /** Toujours 12 mois, de janvier à décembre, à zéro sans facture. */
  months: z.array(monthSchema).length(12),
  /** Un fournisseur par ligne, trié par nom ; factures sans fournisseur en dernier. */
  bySupplier: z.array(
    supplierRecapAmountsSchema.extend({
      supplierId: id.nullable(),
      supplierName: z.string().nullable(),
      months: z.array(monthSchema).length(12),
    }),
  ),
  totals: supplierRecapAmountsSchema,
});

export type SupplierRecapAmounts = z.infer<typeof supplierRecapAmountsSchema>;
export type SupplierAnnualRecapResponse = z.infer<typeof supplierAnnualRecapResponseSchema>;
