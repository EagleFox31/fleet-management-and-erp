/** Date UTC (`YYYY-MM-DD`) d'un instant. */
export function utcDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Date UTC du jour (`YYYY-MM-DD`). */
export function todayUtcDateOnly(now: Date = new Date()): string {
  return utcDateOnly(now);
}
