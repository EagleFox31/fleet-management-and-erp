/**
 * Lignes de travail d'un ordre de travail — règles de calcul et libellés.
 *
 * Ce module ne connaît que des **heures**. Aucun taux horaire, aucun montant :
 * les techniciens sont salariés, valoriser leurs heures les compterait une
 * seconde fois dans les charges du tableau de bord Direction.
 * Voir `docs/plans/lignes-de-travail-ot.md`, section « Périmètre ».
 *
 * Source unique : le service et les écrans importent d'ici.
 */

export const WORK_ORDER_ITEM_STATUSES = ["pending", "in_progress", "done", "cancelled"] as const;

export type WorkOrderItemStatus = (typeof WORK_ORDER_ITEM_STATUSES)[number];

/** Le libellé décrit la ligne de travail suivie, pas l'action (AGENTS.md §1). */
export const WORK_ORDER_ITEM_STATUS_LABELS: Record<WorkOrderItemStatus, string> = {
  pending: "À faire",
  in_progress: "En cours",
  done: "Terminée",
  cancelled: "Annulée",
};

export function getWorkOrderItemStatusLabel(status: string): string {
  return WORK_ORDER_ITEM_STATUS_LABELS[status as WorkOrderItemStatus] ?? status;
}

export function isWorkOrderItemStatus(value: unknown): value is WorkOrderItemStatus {
  return typeof value === "string" && (WORK_ORDER_ITEM_STATUSES as readonly string[]).includes(value);
}

/**
 * Heures lues depuis la base (`numeric` arrive en chaîne) ou depuis un formulaire.
 *
 * Renvoie `null` dès que la valeur n'est pas une mesure exploitable — absente,
 * vide, illisible ou négative. `null` veut dire « on ne sait pas », jamais zéro :
 * une ligne non mesurée ne doit pas tirer une moyenne vers le bas.
 */
export function parseHours(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return parsed;
}

export interface WorkOrderItemHoursInput {
  status?: string | null;
  estimatedHours?: number | string | null;
  actualHours?: number | string | null;
  /** Barème du poste catalogue rattaché, `null` pour un travail hors catalogue. */
  standardHours?: number | string | null;
}

export interface WorkOrderItemTotals {
  /** Lignes retenues : les lignes annulées ne comptent pas. */
  lineCount: number;
  /** Lignes qui portent des heures réelles. */
  measuredLineCount: number;
  /** Lignes sans heures réelles : tant que > 0, le total est partiel. */
  unmeasuredLineCount: number;
  estimatedHours: number | null;
  actualHours: number | null;
  /** Barème cumulé des seules lignes comparables (réel ET barème présents). */
  standardHours: number | null;
  /** Réel − barème sur ces mêmes lignes. Positif = dépassement. */
  varianceHours: number | null;
}

const EMPTY_TOTALS: WorkOrderItemTotals = {
  lineCount: 0,
  measuredLineCount: 0,
  unmeasuredLineCount: 0,
  estimatedHours: null,
  actualHours: null,
  standardHours: null,
  varianceHours: null,
};

/** Arrondi centième : `numeric(5,2)` en base, on ne montre pas plus fin. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Totaux d'heures d'une intervention.
 *
 * Deux règles qui expliquent tous les `null` :
 *
 * 1. Une ligne **annulée** est écartée : elle n'a pas eu lieu.
 * 2. Une ligne **sans heures réelles** est exclue du total, pas comptée à zéro.
 *    Même règle que le kilométrage réel du PRK — on n'estime pas à la place
 *    d'une mesure. Le nombre de lignes non mesurées est renvoyé pour que l'écran
 *    puisse dire que le total est partiel.
 *
 * L'écart au barème ne porte que sur les lignes qui ont **les deux** valeurs :
 * comparer un réel à un barème absent produirait un dépassement imaginaire.
 */
export function computeWorkOrderItemTotals(items: WorkOrderItemHoursInput[]): WorkOrderItemTotals {
  if (!Array.isArray(items) || items.length === 0) return { ...EMPTY_TOTALS };

  const retenues = items.filter((item) => item.status !== "cancelled");
  if (retenues.length === 0) return { ...EMPTY_TOTALS };

  let estimatedSum = 0;
  let estimatedCount = 0;
  let actualSum = 0;
  let measuredLineCount = 0;
  let standardSum = 0;
  let comparableActualSum = 0;
  let comparableCount = 0;

  for (const item of retenues) {
    const estimated = parseHours(item.estimatedHours);
    if (estimated !== null) {
      estimatedSum += estimated;
      estimatedCount += 1;
    }

    const actual = parseHours(item.actualHours);
    if (actual === null) continue;

    actualSum += actual;
    measuredLineCount += 1;

    const standard = parseHours(item.standardHours);
    if (standard !== null) {
      standardSum += standard;
      comparableActualSum += actual;
      comparableCount += 1;
    }
  }

  return {
    lineCount: retenues.length,
    measuredLineCount,
    unmeasuredLineCount: retenues.length - measuredLineCount,
    estimatedHours: estimatedCount > 0 ? round2(estimatedSum) : null,
    actualHours: measuredLineCount > 0 ? round2(actualSum) : null,
    standardHours: comparableCount > 0 ? round2(standardSum) : null,
    varianceHours: comparableCount > 0 ? round2(comparableActualSum - standardSum) : null,
  };
}

export interface WorkOrderItemDraft {
  laborCatalogId?: number | null;
  customLabel?: string | null;
  technicianId?: number | null;
  estimatedHours?: number | string | null;
  actualHours?: number | string | null;
  status?: string | null;
}

export interface WorkOrderItemValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Une ligne dit toujours quel travail a été fait : soit un poste du catalogue,
 * soit un libellé libre. Sans l'un des deux, la ligne est illisible dans
 * l'historique du camion six mois plus tard.
 */
export function validateWorkOrderItem(draft: WorkOrderItemDraft): WorkOrderItemValidation {
  const errors: string[] = [];

  const catalogId = Number(draft.laborCatalogId);
  const aUnPoste = Number.isInteger(catalogId) && catalogId > 0;
  const libelle = typeof draft.customLabel === "string" ? draft.customLabel.trim() : "";

  if (!aUnPoste && libelle === "") {
    errors.push("Choisir un poste du catalogue ou saisir un libellé de travail.");
  }

  if (draft.status !== null && draft.status !== undefined && !isWorkOrderItemStatus(draft.status)) {
    errors.push("Statut de ligne inconnu.");
  }

  for (const [champ, valeur, libelleChamp] of [
    ["estimatedHours", draft.estimatedHours, "estimées"],
    ["actualHours", draft.actualHours, "réelles"],
  ] as const) {
    if (valeur === null || valeur === undefined || (typeof valeur === "string" && valeur.trim() === "")) {
      continue;
    }
    if (parseHours(valeur) === null) {
      errors.push(`Les heures ${libelleChamp} doivent être un nombre positif.`);
    } else if (Number(valeur) > 999) {
      // `numeric(5,2)` : au-delà, l'insertion échouerait côté base.
      errors.push(`Les heures ${libelleChamp} dépassent la valeur maximale (999).`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Libellé affiché d'une ligne : le poste catalogue prime sur le texte libre. */
export function resolveWorkOrderItemLabel(item: {
  laborCatalogLabel?: string | null;
  customLabel?: string | null;
}): string {
  const catalogue = typeof item.laborCatalogLabel === "string" ? item.laborCatalogLabel.trim() : "";
  if (catalogue !== "") return catalogue;

  const libre = typeof item.customLabel === "string" ? item.customLabel.trim() : "";
  return libre !== "" ? libre : "Travail sans libellé";
}
