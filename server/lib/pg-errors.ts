/**
 * Lecture des codes d'erreur Postgres. Drizzle enveloppe parfois l'erreur du
 * pilote dans `cause` : on regarde les deux niveaux.
 */
function pgFieldOf(error: unknown, field: "code" | "constraint"): string | undefined {
  for (let current: unknown = error, depth = 0; current && typeof current === "object" && depth < 3; depth++) {
    const value = (current as Record<string, unknown>)[field];
    if (typeof value === "string") return value;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

const pgCodeOf = (error: unknown) => pgFieldOf(error, "code");

/** Nom de la contrainte violée (erreur du pilote ou sa `cause`). */
export function pgConstraintOf(error: unknown): string | undefined {
  return pgFieldOf(error, "constraint");
}

/** Violation d'une contrainte UNIQUE (23505). */
export function isUniqueViolation(error: unknown): boolean {
  return pgCodeOf(error) === "23505";
}

/** Violation d'une contrainte CHECK (23514). */
export function isCheckViolation(error: unknown): boolean {
  return pgCodeOf(error) === "23514";
}
