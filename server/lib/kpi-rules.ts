/**
 * Règles de calcul des indicateurs de pilotage (chantier CDC #7), sans entrée-sortie.
 *
 * `server/services/kpi-service.ts` lit les lignes, ce module décide : mois à zéro et moyenne,
 * échéance préventive et retard, taux horaire en vigueur, coût d'un OT. Toute date est un
 * `AAAA-MM-JJ` ; « aujourd'hui » et « hier » se lisent en Africa/Douala, jamais dans le
 * fuseau du serveur (leçon « Heure de fin de verrou décalée du fuseau du serveur »).
 */

export const KPI_TIME_ZONE = "Africa/Douala";

/** Jour calendaire de `now` dans le fuseau demandé (`AAAA-MM-JJ`). */
export function isoDateInZone(now: Date, timeZone: string = KPI_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Premier jour du mois, décalé de `delta` mois (négatif = passé). */
export function monthStart(iso: string, delta = 0): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 10);
}

export type KpiWindow = { from: string; to: string; toExclusive: string };

/**
 * Sans `to` : aujourd'hui (Douala). Sans `from` : le 1er du mois, 11 mois avant celui de `to`,
 * soit 12 mois calendaires dont le mois en cours. Bornes incluses.
 */
export function resolveKpiWindow(query: { from?: string; to?: string }, now: Date = new Date()): KpiWindow {
  const to = query.to ?? isoDateInZone(now);
  const from = query.from ?? monthStart(to, -11);
  return { from, to, toExclusive: addDays(to, 1) };
}

/** Mois `AAAA-MM` de chaque mois calendaire qui touche [from, to], dans l'ordre. */
export function monthKeysBetween(from: string, to: string): string[] {
  if (from > to) return [];
  const keys: string[] = [];
  for (let cursor = monthStart(from); cursor <= to; cursor = monthStart(cursor, 1)) {
    keys.push(cursor.slice(0, 7));
  }
  return keys;
}

export type MonthCount = { month: string; count: number };

/** Une ligne par mois de la période, zéro compris ; les mois hors période d'une ligne reçue sont ignorés. */
export function fillMonthSeries(rows: readonly MonthCount[], from: string, to: string): MonthCount[] {
  const counts = new Map(rows.map((r) => [r.month, r.count] as const));
  return monthKeysBetween(from, to).map((month) => ({ month, count: counts.get(month) ?? 0 }));
}

/** Moyenne mensuelle sur tous les mois de la période, mois à zéro compris, deux décimales. */
export function monthlyAverage(total: number, months: number): number {
  if (months <= 0) return 0;
  return Math.round((total / months) * 100) / 100;
}

// --- Préventif -------------------------------------------------------------------------

export const MAX_TOLERANCE_DAYS = 30;

/** Tolérance configurable (`KPI_PREVENTIVE_TOLERANCE_DAYS`), entière, bornée ; 0 si illisible. */
export function parseToleranceDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(n, MAX_TOLERANCE_DAYS);
}

/**
 * Échéance d'un OT préventif : la date figée à la génération (`due_date`) ; à défaut la date de
 * début. Replanifier le début ne déplace donc pas l'échéance d'un OT qui en a une.
 */
export function effectiveDueDate(dueDate: string | null | undefined, startDate: string | null | undefined): string | null {
  return dueDate ?? startDate ?? null;
}

/** Dernier jour compté : le plus petit de `to` et de la veille (rien n'est échu aujourd'hui). */
export function preventiveWindowEnd(to: string, today: string): string {
  const yesterday = addDays(today, -1);
  return to < yesterday ? to : yesterday;
}

export type PreventiveOccurrence = {
  status: string;
  /** Échéance `AAAA-MM-JJ`. */
  due: string;
  /** Jour de clôture `AAAA-MM-JJ`, s'il existe. */
  doneOn: string | null;
};

export type PreventiveOutcome = "onTime" | "late" | "cancelled";

/** Annulé = non réalisé ; réalisé à temps = clos au plus tard à l'échéance plus la tolérance. */
export function classifyPreventive(occ: PreventiveOccurrence, toleranceDays = 0): PreventiveOutcome {
  if (occ.status === "cancelled") return "cancelled";
  if (occ.status === "completed" && occ.doneOn && occ.doneOn <= addDays(occ.due, toleranceDays)) return "onTime";
  return "late";
}

export type PreventiveSummary = {
  planned: number;
  doneOnTime: number;
  rate: number | null;
  late: number;
  cancelled: number;
  withoutWorkOrder: number;
};

/**
 * `uncoveredSchedules` : planifications actives échues sans OT préventif, comptées au
 * dénominateur et parmi les retards (rien n'a été réalisé).
 */
export function summarizePreventive(
  occurrences: readonly PreventiveOccurrence[],
  uncoveredSchedules: number,
  toleranceDays = 0,
): PreventiveSummary {
  let doneOnTime = 0;
  let late = 0;
  let cancelled = 0;
  for (const occ of occurrences) {
    const outcome = classifyPreventive(occ, toleranceDays);
    if (outcome === "onTime") doneOnTime++;
    else if (outcome === "cancelled") cancelled++;
    else late++;
  }
  late += uncoveredSchedules;
  const planned = occurrences.length + uncoveredSchedules;
  return { planned, doneOnTime, rate: planned === 0 ? null : doneOnTime / planned, late, cancelled, withoutWorkOrder: uncoveredSchedules };
}

// --- Coût ------------------------------------------------------------------------------

export type LaborRate = { effectiveFrom: string; hourlyRateHt: number };

/** Taux en vigueur à `date` : la ligne au plus grand `effectiveFrom` inférieur ou égal à la date. */
export function laborRateAt(rates: readonly LaborRate[], date: string): number | null {
  let best: LaborRate | null = null;
  for (const rate of rates) {
    if (rate.effectiveFrom <= date && (best === null || rate.effectiveFrom > best.effectiveFrom)) best = rate;
  }
  return best ? best.hourlyRateHt : null;
}

export type WorkOrderCostInput = {
  /** `work_orders.cost` : main-d'oeuvre saisie. */
  cost: number;
  /** Somme des heures réelles des lignes de travail non annulées. */
  hours: number;
  /** Taux horaire HT en vigueur à la date de l'OT, ou `null`. */
  rate: number | null;
  /** Σ quantité × prix unitaire des pièces utilisées. */
  parts: number;
  /** Σ coût des rotations de pneus de l'OT (`tire_rotations.cost`). */
  tires: number;
};

export type WorkOrderCost = { labor: number; parts: number; tires: number; total: number; laborMissing: boolean };

/**
 * Main-d'oeuvre : heures réelles × taux quand un taux est en vigueur et que des heures sont
 * saisies ; sinon le coût saisi (jamais les deux : `cost` est déjà la main-d'oeuvre).
 * Pièces et rotations de pneus s'ajoutent, comme sur l'écran et le PDF de l'OT (WO5).
 * Montants arrondis au FCFA par composante, donc `labor + parts + tires = total` exactement.
 */
export function workOrderCost(input: WorkOrderCostInput): WorkOrderCost {
  const valued = input.rate !== null && input.hours > 0;
  const laborRaw = valued ? input.hours * (input.rate as number) : input.cost;
  const labor = Math.round(Math.max(laborRaw, 0));
  const parts = Math.round(Math.max(input.parts, 0));
  const tires = Math.round(Math.max(input.tires, 0));
  return { labor, parts, tires, total: labor + parts + tires, laborMissing: laborRaw <= 0 };
}

export type CostRow = WorkOrderCost & { key: string; label: string; isPreventive: boolean };

export type CostGroup = { key: string; label: string; interventions: number; totalCost: number; averageCost: number | null };

export function groupCosts(rows: readonly CostRow[], keyOf: (row: CostRow) => { key: string; label: string }): CostGroup[] {
  const groups = new Map<string, CostGroup>();
  for (const row of rows) {
    const { key, label } = keyOf(row);
    const g = groups.get(key) ?? { key, label, interventions: 0, totalCost: 0, averageCost: null };
    g.interventions++;
    g.totalCost += row.total;
    groups.set(key, g);
  }
  const list = [...groups.values()];
  for (const g of list) g.averageCost = g.interventions === 0 ? null : Math.round(g.totalCost / g.interventions);
  return list;
}

export function averageCost(totalCost: number, interventions: number): number | null {
  return interventions === 0 ? null : Math.round(totalCost / interventions);
}

// --- Échéance posée à la génération d'un OT préventif ------------------------------------

/**
 * Jour d'échéance (`AAAA-MM-JJ`) à figer sur un OT préventif : la date d'échéance de
 * l'élément qui le déclenche (assurance, contrôle technique, planification) ; à défaut le jour
 * de génération. Lu en Africa/Douala, jamais dans le fuseau du serveur.
 */
export function preventiveDueDay(source: Date | string | null | undefined, now: Date = new Date()): string {
  if (typeof source === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source)) return source;
  if (source) {
    const d = source instanceof Date ? source : new Date(source);
    if (!Number.isNaN(d.getTime())) return isoDateInZone(d);
  }
  return isoDateInZone(now);
}

// --- Période d'un rapport mensuel ou trimestriel -----------------------------------------

export type ReportPeriodKind = "month" | "quarter";

export type ReportPeriod = { kind: ReportPeriodKind; from: string; to: string; label: string };

const MONTH_NAMES = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

/** Dernier jour du mois qui contient `iso`. */
function monthEnd(iso: string): string {
  return addDays(monthStart(iso, 1), -1);
}

function calendarPeriod(kind: ReportPeriodKind, anchor: string): ReportPeriod {
  const [y, m] = anchor.split("-").map(Number);
  if (kind === "month") {
    return { kind, from: monthStart(anchor), to: monthEnd(anchor), label: `${MONTH_NAMES[m - 1]} ${y}` };
  }
  const q = Math.floor((m - 1) / 3);
  const from = `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`;
  return { kind, from, to: monthEnd(monthStart(from, 2)), label: `T${q + 1} ${y}` };
}

/**
 * Période d'un rapport. `from` et `to` donnés : exactement cette fenêtre (le type ne sert qu'à
 * l'intitulé). Un seul des deux : la période calendaire (mois ou trimestre) qui le contient.
 * Aucun : la dernière période terminée (rapport produit au début de la suivante).
 */
export function resolveReportPeriod(
  kind: ReportPeriodKind,
  query: { from?: string; to?: string },
  now: Date = new Date(),
): ReportPeriod {
  if (query.from && query.to) {
    const cal = calendarPeriod(kind, query.from);
    const exact = cal.from === query.from && cal.to === query.to;
    return { kind, from: query.from, to: query.to, label: exact ? cal.label : `${query.from} au ${query.to}` };
  }
  const anchor = query.from ?? query.to;
  if (anchor) return calendarPeriod(kind, anchor);
  const current = calendarPeriod(kind, isoDateInZone(now));
  return calendarPeriod(kind, addDays(current.from, -1));
}
