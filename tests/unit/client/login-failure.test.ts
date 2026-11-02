import { describe, expect, it } from "vitest";
import { ApiError, parseApiError } from "@/lib/api-error";
import { loginFailureOf } from "@/lib/lockout-message";

/** Construit l'ApiError comme `toApiError` le fait à partir du texte brut de la réponse. */
function fromResponse(status: number, body: object): ApiError {
  const text = JSON.stringify(body);
  const parsed = parseApiError(status, text);
  return new ApiError(status, parsed.message, body, parsed);
}

// Corps réel renvoyé par `loginLockoutGuard` après `error-handler`.
const locked429 = (lockedUntil: string) => ({
  lockedUntil,
  message: "Trop de tentatives de connexion. Réessayez plus tard.",
  code: "RATE_LIMITED",
  requestId: "req-1",
});

describe("refus de connexion lu dans la réponse réelle", () => {
  it("429 du garde de verrouillage : message avec l'heure de fin", () => {
    const until = new Date(2026, 10, 2, 9, 15);
    const failure = loginFailureOf(fromResponse(429, locked429(until.toISOString())));
    expect(failure).toEqual({ kind: "locked", message: "Compte verrouillé jusqu'à 09:15." });
  });

  it("429 sans lockedUntil (limiteur générique) : pas un verrouillage", () => {
    const err = fromResponse(429, { message: "Trop de requêtes.", code: "RATE_LIMITED" });
    expect(loginFailureOf(err).kind).toBe("other");
  });

  it("400 de validation, 401, erreur réseau : identifiants incorrects (other)", () => {
    const other400 = fromResponse(400, { message: "Données invalides.", code: "VALIDATION", errors: [{ field: "username", message: "Requis." }] });
    expect(loginFailureOf(other400).kind).toBe("other");
    expect(loginFailureOf(fromResponse(401, { message: "Identifiants invalides.", code: "UNAUTHORIZED" }))).toEqual({ kind: "other", message: null });
    expect(loginFailureOf(new TypeError("Failed to fetch")).kind).toBe("other");
  });
});
