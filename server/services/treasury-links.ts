import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { isoDateInZone } from "@shared/contracts/kpi-period";
import type { TreasuryCategory, TreasuryDirection } from "@shared/contracts/treasury";
import { treasuryEntries, type FuelRecord, type MissionBudgetRow, type SupplierInvoiceSettlement } from "@shared/schema";
import { AppError } from "../lib/app-error";
import { isFeatureEnabled } from "../lib/feature-flags";
import { moduleLogger } from "../lib/logger";
import type { DbExecutor } from "../lib/fuel-card-lock";
import { requireActiveAccount } from "./treasury-service";

const log = moduleLogger("treasury-links");

/**
 * Écritures de trésorerie posées par une autre opération (lots T2 et T3), toujours dans la
 * transaction de cette opération : si elle échoue, l'écriture est annulée avec elle.
 *
 * Rejeu : chaque ligne porte une clé dérivée de sa source (`fuel:<id>`, `settlement:<id>`,
 * `mission-budget:<id>:<poste>`) et
 * s'insère en `ON CONFLICT DO NOTHING` : rejouer l'opération ne crée jamais de seconde ligne.
 *
 * Verrous : aucun verrou n'est pris ici. Côté carburant, l'appelant tient déjà `lockFuelCard` ;
 * l'ordre d'acquisition est donc toujours « verrou carte, puis lignes du journal ».
 */

/** Montant à deux décimales, ou `null` s'il n'y a rien à écrire (montant nul ou illisible). */
export function toTreasuryAmount(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return cents > 0 ? (cents / 100).toFixed(2) : null;
}

type LinkedLine = {
  accountId: number;
  direction: TreasuryDirection;
  amount: string;
  entryDate: string;
  label: string;
  category: TreasuryCategory;
  requestKey: string;
  pieceRef?: string | null;
  counterpartyLabel?: string | null;
  transferGroup?: string | null;
  vehicleId?: number | null;
  missionId?: number | null;
  supplierId?: number | null;
  fuelRecordId?: number | null;
  supplierSettlementId?: number | null;
};

async function insertLinked(tx: DbExecutor, userId: number | null, line: LinkedLine): Promise<void> {
  await tx
    .insert(treasuryEntries)
    .values({ ...line, createdBy: userId, updatedBy: userId })
    .onConflictDoNothing({ target: treasuryEntries.requestKey });
}

async function activeFuelCardAccountId(tx: DbExecutor): Promise<number | null> {
  const res = await tx.execute(sql`SELECT id FROM treasury_accounts WHERE kind = 'fuel_card' AND is_active ORDER BY id LIMIT 1`);
  const row = res.rows[0] as { id: number } | undefined;
  // Drapeau actif sans compte carte : les mouvements de la carte échappent au journal.
  if (!row) log.warn("Drapeau finance actif sans compte carte carburant actif : mouvement de carte non écrit au journal");
  return row ? Number(row.id) : null;
}

const fuelKey = (id: number) => `fuel:${id}`;
/** Jour local (Africa/Douala), pas le jour UTC : une écriture passée à 0 h 30 est datée du jour même. */
const today = () => isoDateInZone(new Date());
const fuelDate = (record: FuelRecord) => (record.date ? String(record.date).slice(0, 10) : today());

/**
 * Recharge de la carte : entrée sur le compte carte. Avec un compte source, la recharge devient un
 * virement interne (sortie du compte source, entrée sur la carte, même `transferGroup`).
 * Sans drapeau `finance` ni compte carte, rien n'est écrit, sauf si un compte source est demandé :
 * on refuse alors plutôt que de perdre la sortie.
 */
export async function linkFuelRecharge(
  tx: DbExecutor,
  record: FuelRecord,
  userId: number | null,
  sourceAccountId?: number | null,
): Promise<void> {
  const enabled = isFeatureEnabled("finance");
  const cardId = enabled ? await activeFuelCardAccountId(tx) : null;
  if (!cardId) {
    if (sourceAccountId) throw new AppError(409, "Aucun compte carte carburant actif en trésorerie : choisissez « sans compte source ».");
    return;
  }
  const amount = toTreasuryAmount(record.creditAmount);
  if (!amount) return;
  const base = { amount, entryDate: fuelDate(record), fuelRecordId: record.id, pieceRef: record.orderNumber ?? null };
  if (!sourceAccountId) {
    await insertLinked(tx, userId, { ...base, accountId: cardId, direction: "in", label: "Recharge carte carburant", category: "appro", requestKey: fuelKey(record.id) });
    return;
  }
  const source = await requireActiveAccount(tx as never, sourceAccountId);
  // Banque ou caisse seulement, jamais la carte (ni un type de compte ajouté plus tard sans décision).
  if (source.id === cardId || (source.kind !== "bank" && source.kind !== "cash")) {
    throw new AppError(400, "Le compte source d'une recharge doit être une banque ou une caisse.");
  }
  const transferGroup = randomUUID();
  await insertLinked(tx, userId, { ...base, accountId: source.id, direction: "out", label: "Recharge carte carburant", category: "virement_interne", counterpartyLabel: "Carte carburant", transferGroup, requestKey: `${fuelKey(record.id)}:source` });
  await insertLinked(tx, userId, { ...base, accountId: cardId, direction: "in", label: "Recharge carte carburant", category: "virement_interne", counterpartyLabel: source.label, transferGroup, requestKey: fuelKey(record.id) });
}

/**
 * Suppression d'un plein ou d'une recharge : contre-passation de ses écritures (`fuel:<id>` et,
 * pour une recharge payée par un compte source, `fuel:<id>:source`). L'historique reste, le solde
 * du journal redevient celui de la carte. Indépendant du drapeau : on corrige ce qui a été écrit.
 * L'appelant tient `lockFuelCard`.
 */
export async function reverseFuelLink(tx: DbExecutor, fuelRecordId: number, userId: number | null): Promise<void> {
  const keys = [fuelKey(fuelRecordId), `${fuelKey(fuelRecordId)}:source`];
  const res = await tx.execute(sql`
    SELECT request_key, account_id, direction, amount::text AS amount, category, label, piece_ref,
           counterparty_label, transfer_group, vehicle_id, mission_id
    FROM treasury_entries WHERE request_key IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
    ORDER BY request_key`);
  const lines = res.rows as Array<{
    request_key: string; account_id: number; direction: TreasuryDirection; amount: string; category: TreasuryCategory;
    label: string; piece_ref: string | null; counterparty_label: string | null; transfer_group: string | null;
    vehicle_id: number | null; mission_id: number | null;
  }>;
  if (lines.length === 0) return;
  // Un virement contre-passé reste un virement : ses deux lignes inverses partagent un nouveau groupe.
  const transferGroup = lines.some((l) => l.transfer_group) ? randomUUID() : null;
  for (const line of lines) {
    await insertLinked(tx, userId, {
      accountId: Number(line.account_id),
      direction: line.direction === "in" ? "out" : "in",
      amount: line.amount,
      entryDate: today(),
      label: `Annulation : ${line.label}`,
      category: line.category,
      pieceRef: line.piece_ref,
      counterpartyLabel: line.counterparty_label,
      transferGroup: line.transfer_group ? transferGroup : null,
      vehicleId: line.vehicle_id,
      missionId: line.mission_id,
      fuelRecordId,
      requestKey: `${line.request_key}:reverse`,
    });
  }
}

/** Plein payé par la carte : sortie du compte carte, liée au plein. Sans drapeau ni compte carte : rien. */
export async function linkFuelConsumption(tx: DbExecutor, record: FuelRecord, userId: number | null): Promise<void> {
  if (!isFeatureEnabled("finance")) return;
  const cardId = await activeFuelCardAccountId(tx);
  if (!cardId) return;
  const amount = toTreasuryAmount(record.debitAmount);
  if (!amount) return;
  await insertLinked(tx, userId, {
    accountId: cardId,
    direction: "out",
    amount,
    entryDate: fuelDate(record),
    label: `Plein ${record.stationName ?? ""}`.trim(),
    category: "carburant",
    requestKey: fuelKey(record.id),
    vehicleId: record.vehicleId ?? null,
    missionId: record.missionId ?? null,
    fuelRecordId: record.id,
  });
}

const settlementKey = (id: number) => `settlement:${id}`;

/** Règlement fournisseur saisi avec un compte : sortie de ce compte, dans la transaction de la saisie. */
export async function linkSupplierSettlement(
  tx: DbExecutor,
  settlement: SupplierInvoiceSettlement,
  invoice: { invoiceNumber: string; supplierId: number | null },
  userId: number,
): Promise<void> {
  if (!settlement.treasuryAccountId) return;
  if (!isFeatureEnabled("finance")) throw new AppError(409, "La trésorerie n'est pas activée : laissez le compte de trésorerie vide.");
  const account = await requireActiveAccount(tx as never, settlement.treasuryAccountId);
  if (account.kind === "fuel_card") throw new AppError(400, "Un règlement fournisseur ne sort pas de la carte carburant.");
  const amount = toTreasuryAmount(settlement.amount);
  if (!amount) return;
  await insertLinked(tx, userId, {
    accountId: account.id,
    direction: "out",
    amount,
    entryDate: String(settlement.paymentDate).slice(0, 10),
    label: `Règlement facture ${invoice.invoiceNumber}`,
    category: "reglement_fournisseur",
    pieceRef: settlement.paymentReference,
    supplierId: invoice.supplierId,
    supplierSettlementId: settlement.id,
    requestKey: settlementKey(settlement.id),
  });
}

/**
 * Rejet d'un règlement : contre-passation (entrée du même montant sur le même compte) si une sortie
 * a été écrite. Une écriture n'est jamais supprimée. Indépendant du drapeau : le journal doit rester juste.
 */
export async function reverseSupplierSettlement(tx: DbExecutor, settlementId: number, userId: number): Promise<void> {
  const res = await tx.execute(sql`
    SELECT account_id, amount::text AS amount, piece_ref, label, supplier_id
    FROM treasury_entries WHERE request_key = ${settlementKey(settlementId)}`);
  const out = res.rows[0] as { account_id: number; amount: string; piece_ref: string | null; label: string; supplier_id: number | null } | undefined;
  if (!out) return;
  await insertLinked(tx, userId, {
    accountId: Number(out.account_id),
    direction: "in",
    amount: out.amount,
    entryDate: today(),
    label: `Annulation : ${out.label}`,
    category: "reglement_fournisseur",
    pieceRef: out.piece_ref,
    supplierId: out.supplier_id,
    supplierSettlementId: settlementId,
    requestKey: `${settlementKey(settlementId)}:reject`,
  });
}

const missionBudgetKey = (id: number, line: "carburant" | "fdr") => `mission-budget:${id}:${line}`;

/**
 * Décaissement d'un budget de mission (L1c), dans la transaction de la transition `disbursed` :
 * deux sorties du compte choisi, liées à la mission — carburant, puis FDR et frais annexes.
 * Sans compte : rien n'est écrit (le décaissement reste un marquage). Compte demandé sans drapeau
 * `finance` : 409. Banque ou caisse seulement, jamais la carte carburant : 400.
 * Renvoie l'écriture à retenir sur le budget (FDR, sinon carburant), ou `null` si rien n'est écrit.
 */
export async function linkMissionBudgetDisbursement(
  tx: DbExecutor,
  budget: MissionBudgetRow,
  accountId: number | null | undefined,
  userId: number,
): Promise<number | null> {
  if (!accountId) return null;
  if (!isFeatureEnabled("finance")) throw new AppError(409, "La trésorerie n'est pas activée : laissez le compte de trésorerie vide.");
  const account = await requireActiveAccount(tx as never, accountId);
  if (account.kind !== "bank" && account.kind !== "cash") {
    throw new AppError(400, "Un budget de mission se décaisse d'une banque ou d'une caisse.");
  }
  const base = { accountId: account.id, direction: "out" as const, entryDate: today(), missionId: budget.missionId };
  const lines = [
    { key: missionBudgetKey(budget.id, "fdr"), amount: toTreasuryAmount(Number(budget.fdrAmount) + Number(budget.extrasAmount)), label: "Budget de mission : FDR et frais annexes", category: "fdr" as const },
    { key: missionBudgetKey(budget.id, "carburant"), amount: toTreasuryAmount(budget.fuelAmount), label: "Budget de mission : carburant", category: "carburant" as const },
  ];
  let retained: number | null = null;
  for (const line of lines) {
    if (!line.amount) continue;
    await insertLinked(tx, userId, { ...base, amount: line.amount, label: line.label, category: line.category, requestKey: line.key });
    if (retained !== null) continue;
    // Rejeu : la ligne déjà écrite sous cette clé est retenue.
    const res = await tx.execute(sql`SELECT id FROM treasury_entries WHERE request_key = ${line.key}`);
    retained = Number((res.rows[0] as { id: number }).id);
  }
  return retained;
}

/**
 * Mission annulée après décaissement (L1d) : le reliquat non justifié de chaque ligne décaissée revient
 * au compte d'où il est sorti, par une entrée « in » de clé `<clé>:reverse`. Rejouable : une clé déjà
 * prise n'écrit rien. Sans ligne au journal (décaissement sans compte, ou budget non décaissé) : rien.
 * Comme `reverseFuelLink`, indépendant du drapeau : une sortie déjà écrite se contre-passe toujours.
 * Renvoie le nombre de lignes de contre-passation visées.
 */
export async function reverseMissionBudgetDisbursements(tx: DbExecutor, budgetIds: number[], userId: number | null): Promise<number> {
  if (budgetIds.length === 0) return 0;
  const keys = budgetIds.flatMap((id) => [missionBudgetKey(id, "fdr"), missionBudgetKey(id, "carburant")]);
  const res = await tx.execute(sql`
    SELECT request_key, account_id, amount::text AS amount, category, label, mission_id
    FROM treasury_entries WHERE request_key IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
    ORDER BY request_key`);
  const lines = res.rows as Array<{
    request_key: string; account_id: number; amount: string; category: TreasuryCategory; label: string; mission_id: number | null;
  }>;
  let reversed = 0;
  for (const line of lines) {
    // Dépenses justifiées conservées. Aucune pièce justificative n'existe encore sur le budget :
    // justifié = 0, le reliquat est le montant décaissé.
    const justified = 0;
    const amount = toTreasuryAmount(Number(line.amount) - justified);
    if (!amount) continue;
    await insertLinked(tx, userId, {
      accountId: Number(line.account_id),
      direction: "in",
      amount,
      entryDate: today(),
      label: `Contre-passation (mission annulée) : ${line.label}`,
      category: line.category,
      missionId: line.mission_id,
      requestKey: `${line.request_key}:reverse`,
    });
    reversed += 1;
  }
  return reversed;
}
