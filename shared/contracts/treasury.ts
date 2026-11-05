/**
 * Journal de trésorerie (lot T1) : contrat partagé serveur / interface.
 *
 * Routes (drapeau `finance`, 404 s'il est coupé) :
 * - GET  /api/treasury/accounts                 comptes + solde courant      (lecture : TREASURY_READ_ROLES)
 * - POST /api/treasury/accounts                 créer un compte              (saisie : TREASURY_WRITE_ROLES)
 * - GET  /api/treasury/accounts/:id/entries     ?month=AAAA-MM[&format=csv]  (lecture)
 * - POST /api/treasury/entries                  une écriture                 (saisie)
 * - POST /api/treasury/transfers                virement interne, 2 lignes   (saisie)
 *
 * Les montants circulent en chaînes décimales à 2 chiffres ("1250.00") : jamais de flottant.
 * Le solde courant est calculé par le serveur (fenêtre SQL), jamais stocké ni recalculé côté client.
 * Une `requestKey` rejoue sans doublon : même clé et même contenu = la ligne existante (200) ; même
 * clé pour un autre contenu = 409.
 */
import { z } from "zod";
import { bodyIdSchema } from "./common";
import { KPI_TIME_ZONE } from "./kpi-period";

export const TREASURY_BASE_PATH = "/api/treasury";
export const TREASURY_ACCOUNT_KINDS = ["bank", "cash", "fuel_card"] as const;
export const TREASURY_DIRECTIONS = ["in", "out"] as const;
export const TREASURY_CATEGORIES = [
  "appro",
  "carburant",
  "salaire",
  "fdr",
  "entretien",
  "investissement",
  "reglement_fournisseur",
  "encaissement_client",
  "virement_interne",
  "autre",
] as const;

export type TreasuryAccountKind = (typeof TREASURY_ACCOUNT_KINDS)[number];
export type TreasuryDirection = (typeof TREASURY_DIRECTIONS)[number];
export type TreasuryCategory = (typeof TREASURY_CATEGORIES)[number];

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isRealDate = (value: string) => {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
const dateSchema = z.string().regex(DATE, "Date invalide (AAAA-MM-JJ).").refine(isRealDate, "Date invalide (AAAA-MM-JJ).");

/** Décimal à 2 chiffres au plus, ramené à "x.yy". Accepte un nombre ou une chaîne. */
const decimal = (allowNegative: boolean) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim().replace(",", "."))
    .refine((v) => (allowNegative ? /^-?\d{1,13}(\.\d{1,2})?$/ : /^\d{1,13}(\.\d{1,2})?$/).test(v), "Montant invalide.")
    .transform(toTwoDecimals);

/** "x.yy" par manipulation de chaîne, sans passer par un flottant : "007.5" -> "7.50", "-0" -> "0.00". */
function toTwoDecimals(v: string): string {
  const negative = v.startsWith("-");
  const [int, frac = ""] = (negative ? v.slice(1) : v).split(".");
  const digits = int.replace(/^0+(?=\d)/, "");
  const cents = frac.padEnd(2, "0");
  const zero = /^0+$/.test(digits) && /^0+$/.test(cents);
  return `${negative && !zero ? "-" : ""}${digits}.${cents}`;
}

export const positiveAmountSchema = decimal(false).refine((v) => Number(v) > 0, "Le montant doit être strictement positif.");
export const signedAmountSchema = decimal(true);

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const requestKeySchema = z.string().trim().min(1).max(100).optional();
// Id lu dans un corps JSON : entier strict, borné au type `integer` de PostgreSQL (sinon 500 en base).
const idSchema = bodyIdSchema;

export const createTreasuryAccountSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/, "Code invalide (lettres, chiffres, - et _, 20 au plus)."),
  label: text(120),
  kind: z.enum(TREASURY_ACCOUNT_KINDS),
  bankName: optionalText(120),
  openingBalance: signedAmountSchema.default("0.00"),
  openingDate: dateSchema.optional().nullable().transform((v) => v ?? null),
});
export type CreateTreasuryAccountInput = z.infer<typeof createTreasuryAccountSchema>;

export const createTreasuryEntrySchema = z.object({
  accountId: idSchema,
  entryDate: dateSchema,
  pieceRef: optionalText(80),
  label: text(200),
  direction: z.enum(TREASURY_DIRECTIONS),
  amount: positiveAmountSchema,
  category: z.enum(TREASURY_CATEGORIES).default("autre"),
  counterpartyLabel: optionalText(120),
  notes: optionalText(1000),
  vehicleId: idSchema.optional().nullable().transform((v) => v ?? null),
  missionId: idSchema.optional().nullable().transform((v) => v ?? null),
  clientId: idSchema.optional().nullable().transform((v) => v ?? null),
  supplierId: idSchema.optional().nullable().transform((v) => v ?? null),
  requestKey: requestKeySchema,
});
export type CreateTreasuryEntryInput = z.infer<typeof createTreasuryEntrySchema>;

export const createTreasuryTransferSchema = z
  .object({
    fromAccountId: idSchema,
    toAccountId: idSchema,
    entryDate: dateSchema,
    amount: positiveAmountSchema,
    label: text(200),
    pieceRef: optionalText(80),
    notes: optionalText(1000),
    requestKey: requestKeySchema,
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, { message: "Les deux comptes doivent être différents.", path: ["toAccountId"] });
export type CreateTreasuryTransferInput = z.infer<typeof createTreasuryTransferSchema>;

export const treasuryLedgerQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mois invalide (AAAA-MM).").optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

export type TreasuryAccount = {
  id: number;
  code: string;
  label: string;
  kind: TreasuryAccountKind;
  bankName: string | null;
  openingBalance: string;
  openingDate: string | null;
  isActive: boolean;
  /** Solde d'ouverture + toutes les écritures du compte. */
  currentBalance: string;
};

export type TreasuryEntry = {
  id: number;
  accountId: number;
  entryDate: string;
  pieceRef: string | null;
  label: string;
  direction: TreasuryDirection;
  amount: string;
  category: TreasuryCategory;
  counterpartyLabel: string | null;
  transferGroup: string | null;
  notes: string | null;
  vehicleId: number | null;
  missionId: number | null;
  clientId: number | null;
  supplierId: number | null;
  /** Solde du compte juste après cette écriture (ordre : date, puis numéro). */
  balanceAfter: string;
};

export type TreasuryLedger = {
  account: TreasuryAccount;
  month: string;
  /** Solde au début du mois. */
  openingBalance: string;
  entries: TreasuryEntry[];
  totals: { in: string; out: string; net: string };
  closingBalance: string;
};

/** Calcul de référence en centimes entiers (oracle des tests contre le SQL). */
const toCents = (v: string) => Math.round(Number(v) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

export function ledgerOf(opening: string, entries: ReadonlyArray<{ direction: TreasuryDirection; amount: string }>) {
  let balance = toCents(opening);
  let inCents = 0;
  let outCents = 0;
  const balances: string[] = [];
  for (const e of entries) {
    const cents = toCents(e.amount);
    if (e.direction === "in") {
      balance += cents;
      inCents += cents;
    } else {
      balance -= cents;
      outCents += cents;
    }
    balances.push(fromCents(balance));
  }
  return { balances, totals: { in: fromCents(inCents), out: fromCents(outCents), net: fromCents(inCents - outCents) }, closing: fromCents(balance) };
}

/** Mois en cours (AAAA-MM) dans le fuseau de l'exploitation : à Douala, minuit arrive une heure avant l'UTC. */
export function currentTreasuryMonth(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KPI_TIME_ZONE, year: "numeric", month: "2-digit" }).format(now).slice(0, 7);
}

/** Mois "AAAA-MM" suivant, pour borner une requête à [début du mois, début du suivant[. */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Export CSV d'un livre : séparateur « ; », BOM pour Excel, cellules neutralisées contre l'injection de formule. */
export function ledgerToCsv(ledger: TreasuryLedger): string {
  const cell = (value: string | number | null) => {
    let text = value === null ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
    return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = ["Date", "Pièce", "Libellé", "Catégorie", "Tiers", "Entrée", "Sortie", "Solde"];
  const lines = [header.map(cell).join(";")];
  for (const e of ledger.entries) {
    lines.push(
      [e.entryDate, e.pieceRef, e.label, e.category, e.counterpartyLabel, e.direction === "in" ? e.amount : "", e.direction === "out" ? e.amount : "", e.balanceAfter]
        .map(cell)
        .join(";"),
    );
  }
  lines.push(["", "", "Total du mois", "", "", ledger.totals.in, ledger.totals.out, ledger.closingBalance].map(cell).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}
