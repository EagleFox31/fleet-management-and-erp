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

/** Violation d'une clé étrangère (23503) : référence absente à l'écriture, ou ligne encore référencée à la suppression. */
export function isForeignKeyViolation(error: unknown): boolean {
  return pgCodeOf(error) === "23503";
}

/** Violation d'une contrainte CHECK (23514). */
export function isCheckViolation(error: unknown): boolean {
  return pgCodeOf(error) === "23514";
}

/** Interblocage (40P01) ou échec de sérialisation (40001) : Postgres a annulé la transaction, la réessayer est sûr. */
export function isTransactionConflict(error: unknown): boolean {
  const code = pgCodeOf(error);
  return code === "40P01" || code === "40001";
}

export const TRANSACTION_CONFLICT_MESSAGE = "Opération en cours, réessayez.";

/** Contrainte portée par le trigger `trg_users_keep_active_admin` (migration 20261105). */
export const LAST_ACTIVE_ADMIN_CONSTRAINT = "users_keep_one_active_admin";

/** Le trigger a refusé de retirer le dernier administrateur actif. */
export function isLastActiveAdminViolation(error: unknown): boolean {
  return isCheckViolation(error) && pgConstraintOf(error) === LAST_ACTIVE_ADMIN_CONSTRAINT;
}

/** Refus de base à laisser remonter à `toHttpError` (400 / 409 lisibles) plutôt que d'être avalé ou converti en 500. */
export function isAdminGuardDbRefusal(error: unknown): boolean {
  return isLastActiveAdminViolation(error) || isTransactionConflict(error);
}

/**
 * Verrous d'argent posés par des triggers (`check_violation`, contrainte nommée) : un plein
 * validé, une facture émise ou un avoir émis ne se modifient plus. Le message est celui
 * montré à l'utilisateur.
 */
export const MONEY_LOCK_MESSAGES: Readonly<Record<string, string>> = {
  fuel_records_validated_locked: "Ce plein est validé : il ne se modifie plus. Annulez-le avec un motif, puis saisissez-en un nouveau.",
  client_invoices_issued_locked: "Cette facture est émise : ses montants ne se modifient plus. Établissez un avoir.",
  client_credit_notes_immutable: "Un avoir émis ne se modifie pas.",
};

/** Message lisible si l'erreur (ou sa `cause`, sur 3 niveaux) est un refus de verrou d'argent. */
export function moneyLockMessageOf(error: unknown): string | undefined {
  if (!isCheckViolation(error)) return undefined;
  const constraint = pgConstraintOf(error);
  return constraint && Object.hasOwn(MONEY_LOCK_MESSAGES, constraint) ? MONEY_LOCK_MESSAGES[constraint] : undefined;
}
