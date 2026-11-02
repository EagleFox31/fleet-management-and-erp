/**
 * Lecture des codes d'erreur Postgres. Drizzle enveloppe parfois l'erreur du
 * pilote dans `cause` : on regarde les deux niveaux.
 */
function pgCodeOf(error: unknown): string | undefined {
  for (let current: unknown = error, depth = 0; current && typeof current === "object" && depth < 3; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Violation d'une contrainte UNIQUE (23505). */
export function isUniqueViolation(error: unknown): boolean {
  return pgCodeOf(error) === "23505";
}

/** Violation d'une clé étrangère (23503) : référence absente à l'écriture, ou ligne encore référencée à la suppression. */
export function isForeignKeyViolation(error: unknown): boolean {
  return pgCodeOf(error) === "23503";
}

/** Violation d'une contrainte CHECK (23514). */
export function isCheckViolation(error: unknown): boolean {
  return pgCodeOf(error) === "23514";
}
