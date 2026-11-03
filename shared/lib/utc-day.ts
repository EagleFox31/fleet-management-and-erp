/** Jour calendaire en UTC, au format AAAA-MM-JJ : l'unique définition du « jour » des règles d'échéance. */
export function utcDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Jour courant en UTC (AAAA-MM-JJ). `now` est injectable pour figer l'horloge dans les tests. */
export function todayUtcDateOnly(now: Date = new Date()): string {
  return utcDateOnly(now);
}
