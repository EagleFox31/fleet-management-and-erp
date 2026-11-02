import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { documentRenewalCenters } from "@shared/schema";
import { normalizeCenterName } from "@shared/contracts/document-renewal-centers";
import { db } from "../db";
import { AppError } from "./app-error";

/**
 * Résolution unique d'un centre de renouvellement (DOC1), partagée par
 * `POST /requests`, `POST /quick-renew` et le routeur des centres.
 * Comparaison par égalité sur un nom normalisé (casse, bords, espaces répétés),
 * jamais par `ilike` : `%`, `_` et `\` du nom saisi ne sont pas des jokers.
 */

export const DISABLED_CENTER_MESSAGE = "Ce centre agréé est désactivé.";
export const DUPLICATE_CENTER_MESSAGE = "Un centre de ce nom existe déjà pour ce type de document.";


const normalizedNameSql = () =>
  sql`regexp_replace(lower(btrim(${documentRenewalCenters.name})), '\\s+', ' ', 'g')`;

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** 409 si un centre de même nom normalisé existe déjà pour ce type (actif ou non). */
export async function assertCenterNameFree(name: string, documentType: string | null, excludeId?: number): Promise<void> {
  const [clash] = await db
    .select({ id: documentRenewalCenters.id })
    .from(documentRenewalCenters)
    .where(
      and(
        sql`${normalizedNameSql()} = ${normalizeCenterName(name)}`,
        documentType === null
          ? isNull(documentRenewalCenters.documentType)
          : eq(documentRenewalCenters.documentType, documentType as any),
        excludeId === undefined ? undefined : ne(documentRenewalCenters.id, excludeId),
      ),
    )
    .limit(1);
  if (clash) throw new AppError(409, DUPLICATE_CENTER_MESSAGE);
}

export type ResolveCenterInput = {
  centerId?: number | null;
  centerName?: string | null;
  centerAddress?: string | null;
  centerContact?: string | null;
  centerAccreditationNumber?: string | null;
  /** Type du centre créé implicitement. */
  documentType: string | null;
  actorUserId: number | null;
};

export type ResolvedCenter =
  | { ok: true; id: number; name: string; accreditationNumber: string | null }
  | { ok: false; status: 404 | 409; message: string };

const COLUMNS = {
  id: documentRenewalCenters.id,
  name: documentRenewalCenters.name,
  accreditationNumber: documentRenewalCenters.accreditationNumber,
  isActive: documentRenewalCenters.isActive,
};

/** Retourne `null` si ni id ni nom : l'appelant décide (centre facultatif ou obligatoire). */
export async function resolveRenewalCenter(input: ResolveCenterInput): Promise<ResolvedCenter | null> {
  if (input.centerId) {
    const [center] = await db.select(COLUMNS).from(documentRenewalCenters).where(eq(documentRenewalCenters.id, input.centerId)).limit(1);
    if (!center) return { ok: false, status: 404, message: "Centre agréé introuvable." };
    if (!center.isActive) return { ok: false, status: 409, message: DISABLED_CENTER_MESSAGE };
    return { ok: true, id: center.id, name: center.name, accreditationNumber: center.accreditationNumber };
  }
  if (!input.centerName) return null;

  const wanted = normalizeCenterName(input.centerName);
  const find = async () =>
    (await db.select(COLUMNS).from(documentRenewalCenters).where(sql`${normalizedNameSql()} = ${wanted}`).limit(1))[0];

  const fromRow = (row: NonNullable<Awaited<ReturnType<typeof find>>>): ResolvedCenter =>
    row.isActive
      ? { ok: true, id: row.id, name: row.name, accreditationNumber: row.accreditationNumber }
      : { ok: false, status: 409, message: DISABLED_CENTER_MESSAGE };

  const found = await find();
  if (found) return fromRow(found);

  try {
    const [created] = await db
      .insert(documentRenewalCenters)
      .values({
        name: input.centerName.trim().replace(/\s+/g, " "),
        documentType: input.documentType as any,
        accreditationNumber: input.centerAccreditationNumber ?? null,
        address: input.centerAddress ?? null,
        contact: input.centerContact ?? null,
        createdBy: input.actorUserId,
      })
      .returning(COLUMNS);
    return fromRow(created);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Course avec une création concurrente du même nom.
    const raced = await find();
    if (raced) return fromRow(raced);
    throw new AppError(409, DUPLICATE_CENTER_MESSAGE, { cause: err });
  }
}
