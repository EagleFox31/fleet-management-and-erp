export type KpiStatus = "success" | "warning" | "critical" | "neutral";

interface RatioThresholds {
  warningBelowRatio: number;
  criticalBelowRatio: number;
}

interface HigherIsBetterThresholds {
  warningBelow: number;
  criticalBelow: number;
}

interface LowerIsBetterThresholds {
  warningAbove: number;
  criticalAbove: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function statusFromRatio(
  goodCount: number,
  totalCount: number,
  thresholds: RatioThresholds = { warningBelowRatio: 0.65, criticalBelowRatio: 0.4 },
): KpiStatus {
  if (!isFiniteNumber(goodCount) || !isFiniteNumber(totalCount) || totalCount <= 0) {
    return "neutral";
  }

  const ratio = goodCount / totalCount;
  if (ratio < thresholds.criticalBelowRatio) {
    return "critical";
  }
  if (ratio < thresholds.warningBelowRatio) {
    return "warning";
  }
  return "success";
}

export function statusWhenHigherIsBetter(
  value: number,
  thresholds: HigherIsBetterThresholds,
): KpiStatus {
  if (!isFiniteNumber(value)) {
    return "neutral";
  }
  if (value <= thresholds.criticalBelow) {
    return "critical";
  }
  if (value < thresholds.warningBelow) {
    return "warning";
  }
  return "success";
}

interface DeadlineThresholds {
  /** En deçà de ce nombre de jours restants, l'échéance passe en `warning`. */
  warningWithinDays: number;
}

/**
 * Jours restants avant une échéance. Négatif si la date est passée,
 * `null` si la date est absente ou invalide.
 *
 * Comparaison à minuit: une échéance « aujourd'hui » vaut 0, pas -1.
 */
export function daysUntilDeadline(date: string | Date | null | undefined): number | null {
  if (!date) {
    return null;
  }

  const echeance = date instanceof Date ? new Date(date) : new Date(date);
  if (Number.isNaN(echeance.getTime())) {
    return null;
  }

  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);
  echeance.setHours(0, 0, 0, 0);

  return Math.round((echeance.getTime() - aujourdhui.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * État d'une échéance (assurance, visite technique, entretien...).
 *
 * Seuil par défaut à 30 jours: c'est celui qu'utilise déjà `alert-service.ts`
 * côté serveur pour déclencher les alertes de documents. Garder les deux
 * alignés, sinon l'écran et la cloche ne diront pas la même chose.
 */
export function statusFromDeadline(
  date: string | Date | null | undefined,
  thresholds: DeadlineThresholds = { warningWithinDays: 30 },
): KpiStatus {
  const jours = daysUntilDeadline(date);

  if (jours === null) {
    return "neutral";
  }
  if (jours < 0) {
    return "critical";
  }
  if (jours <= thresholds.warningWithinDays) {
    return "warning";
  }
  return "success";
}

export function statusWhenLowerIsBetter(
  value: number,
  thresholds: LowerIsBetterThresholds,
): KpiStatus {
  if (!isFiniteNumber(value)) {
    return "neutral";
  }
  if (value >= thresholds.criticalAbove) {
    return "critical";
  }
  if (value > thresholds.warningAbove) {
    return "warning";
  }
  return "success";
}
