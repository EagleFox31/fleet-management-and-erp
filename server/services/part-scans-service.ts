import { eq, inArray, sql } from "drizzle-orm";
import {
  partLabelSchema,
  partLabelsResponseSchema,
  partScanResolveResponseSchema,
  type PartLabel,
  type PartLabelsResponse,
  type PartScanResolveResponse,
} from "@shared/contracts/part-scans";
import { parts } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { buildPartScanPayload, parseScanCode, type ScannedCode } from "../lib/part-scan-code";

/**
 * Lecture des pièces par code scanné et par étiquette (CDC-3). Lecture pure : aucune écriture,
 * aucun mouvement de stock (la sortie reste `POST /api/work-orders/:id/part-requirements/:id/issue`).
 *
 * Les colonnes lues sont énumérées ici : `unit_price`, `supplier` et `supplier_id` ne quittent
 * jamais la base par ce service, donc ne peuvent pas figurer dans une réponse.
 */
const PART_SCAN_COLUMNS = {
  id: parts.id,
  reference: parts.reference,
  name: parts.name,
  quantity: parts.quantity,
  location: parts.location,
  unit: parts.unit,
} as const;

type PartScanRow = { id: number; reference: string; name: string; quantity: number; location: string | null; unit: string };

/** Recherche par format. Un nouveau format de `ScannedCode` ajoute ici sa propre entrée, le compilateur l'exige. */
const FINDERS: { [F in ScannedCode["format"]]: (code: Extract<ScannedCode, { format: F }>) => Promise<PartScanRow[]> } = {
  fleetmaster: (code) =>
    db.select(PART_SCAN_COLUMNS).from(parts).where(eq(parts.id, code.partId)).limit(2),
  // Même expression que l'index `parts_reference_key_idx` : upper(btrim(reference)).
  reference: (code) =>
    db
      .select(PART_SCAN_COLUMNS)
      .from(parts)
      .where(sql`upper(btrim(${parts.reference})) = upper(btrim(${code.reference}))`)
      .limit(2),
};

function find(code: ScannedCode): Promise<PartScanRow[]> {
  const finder = FINDERS[code.format] as (code: ScannedCode) => Promise<PartScanRow[]>;
  return finder(code);
}

function toResolveResponse(row: PartScanRow): PartScanResolveResponse {
  return partScanResolveResponseSchema.parse({
    id: row.id,
    reference: row.reference,
    name: row.name,
    quantity: row.quantity,
    location: row.location ?? null,
    unit: row.unit,
  });
}

export type ResolvedPartScan = { part: PartScanResolveResponse; format: ScannedCode["format"] };

/**
 * Code scanné -> fiche pièce minimale.
 * 400 : code illisible (aucun format ne le reconnaît) ; 404 : lisible mais sans pièce ;
 * 409 : une référence portée par plusieurs pièces (casse ou espaces différents), à lever à la main.
 */
export async function resolveScannedPart(rawCode: string): Promise<ResolvedPartScan> {
  const code = parseScanCode(rawCode);
  if (!code) {
    throw new AppError(400, "Code non reconnu. Scannez l'étiquette de la pièce ou saisissez sa référence.", {
      cause: `code illisible (${rawCode.length} caractères)`,
    });
  }
  const rows = await find(code);
  if (rows.length === 0) {
    throw new AppError(404, "Aucune pièce ne correspond à ce code.", { cause: `format ${code.format} sans résultat` });
  }
  if (rows.length > 1) {
    throw new AppError(409, "Plusieurs pièces portent cette référence. Précisez la pièce depuis le catalogue.", {
      cause: `référence ambiguë (${rows.map((row) => row.id).join(", ")})`,
    });
  }
  return { part: toResolveResponse(rows[0]), format: code.format };
}

/** Étiquettes demandées, dans l'ordre demandé. Les identifiants sans pièce sont listés à part. */
export async function getPartLabels(ids: readonly number[]): Promise<PartLabelsResponse> {
  if (ids.length === 0) return partLabelsResponseSchema.parse({ items: [], missingIds: [] });
  const rows: PartScanRow[] = await db.select(PART_SCAN_COLUMNS).from(parts).where(inArray(parts.id, [...ids]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items: PartLabel[] = [];
  const missingIds: number[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      missingIds.push(id);
      continue;
    }
    items.push(
      partLabelSchema.parse({
        partId: row.id,
        payload: buildPartScanPayload(row.id),
        reference: row.reference,
        name: row.name,
        location: row.location ?? null,
        unit: row.unit,
      }),
    );
  }
  return partLabelsResponseSchema.parse({ items, missingIds });
}
