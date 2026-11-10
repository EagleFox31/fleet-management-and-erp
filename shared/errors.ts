/**
 * Contrat d'erreur de l'API, partagé client / serveur.
 *
 * Règle : l'utilisateur lit une phrase en français, jamais une trace, un code
 * SQL, un JSON ni un message Zod brut. Le détail technique part dans les logs
 * serveur, retrouvable par `requestId` (affiché comme « référence »).
 */
import { z } from "zod";

export type ApiErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  /** 409 sur une écriture rattachée à un véhicule retiré (L3) : refus prononcé avant toute écriture. */
  | "VEHICLE_RETIRED"
  /** 409 d'une écriture rejouable dont la même clé d'idempotence est encore en cours : le client réessaie plus tard, avec la même clé. */
  | "IDEMPOTENCY_IN_PROGRESS"
  /** 503 d'une déclaration de panne dont l'écriture a échoué avant d'être validée : rien n'est enregistré, la même clé peut réessayer. Jamais vu du client (toute 5xx est normalisée en INTERNAL) : il ne sert qu'à libérer la clé d'idempotence. */
  | "INCIDENT_WRITE_FAILED"
  /** 404 d'une déclaration de panne sur un véhicule inexistant : refus prononcé avant toute écriture. */
  | "INCIDENT_VEHICLE_NOT_FOUND"
  | "RATE_LIMITED"
  /** 400 : cible de requête que l'app et un routeur monté liraient différemment (`\` dans le chemin, forme absolue). */
  | "NON_CANONICAL_TARGET"
  | "INTERNAL";

export type ApiFieldError = { field: string; message: string };

export type ApiErrorBody = {
  message: string;
  code: ApiErrorCode;
  requestId?: string;
  errors?: ApiFieldError[];
};

export const STATUS_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION: "Certaines informations sont invalides. Vérifiez le formulaire.",
  UNAUTHENTICATED: "Votre session a expiré. Reconnectez-vous pour continuer.",
  FORBIDDEN: "Votre profil ne permet pas cette action.",
  NOT_FOUND: "L'élément demandé n'existe plus ou a été déplacé.",
  CONFLICT: "Cet élément a été modifié entre-temps. Rechargez la page puis réessayez.",
  VEHICLE_RETIRED: "Véhicule retiré : le restaurer avant de le modifier.",
  IDEMPOTENCY_IN_PROGRESS: "Cet envoi est déjà en cours de traitement. Réessayez dans un instant.",
  INCIDENT_WRITE_FAILED: "La déclaration n'a pas pu être enregistrée. Réessayez dans un instant.",
  INCIDENT_VEHICLE_NOT_FOUND: "Véhicule introuvable.",
  RATE_LIMITED: "Trop de tentatives. Patientez un instant avant de réessayer.",
  NON_CANONICAL_TARGET: "Adresse de requête invalide.",
  INTERNAL: "Une erreur technique est survenue. Réessayez dans un instant.",
};

export const NETWORK_ERROR_MESSAGE = "Connexion au serveur impossible. Vérifiez votre réseau puis réessayez.";

export function codeForStatus(status: number): ApiErrorCode {
  if (status === 400 || status === 413 || status === 415 || status === 422) return "VALIDATION";
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  return "INTERNAL";
}

/** Ajoute la référence à donner au support, quand l'erreur vient du serveur. */
export function withReference(message: string, requestId?: string): string {
  return requestId ? `${message} Référence : ${requestId}.` : message;
}

/**
 * Indique si un texte ressemble à du technique (trace, SQL, JSON, anglais
 * d'une librairie) plutôt qu'à une phrase destinée à l'utilisateur.
 */
export function looksTechnical(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.length > 300) return true;
  if (/^[[{<]/.test(t)) return true;
  return /\b(at \S+:\d+|Error:|TypeError|ReferenceError|SyntaxError|ECONN\w+|ETIMEDOUT|ENOTFOUND|EACCES|ENOSPC|EPERM|SQLSTATE|violates|constraint|relation "|column "|duplicate key|null value|undefined|stack|Expected \w+, received|Required|Invalid (input|enum|type|date)|Cannot read propert)/i.test(
    t,
  );
}

type ZodIssueLike = {
  code?: string;
  message?: string;
  path?: (string | number)[];
  expected?: unknown;
  received?: unknown;
  minimum?: number | bigint;
  maximum?: number | bigint;
  type?: string;
  validation?: unknown;
};

/** Vrai si le message est celui que Zod produit par défaut (en anglais). */
function isZodDefaultMessage(issue: ZodIssueLike): boolean {
  if (!issue.code || !issue.message) return false;
  try {
    const fallback = z.defaultErrorMap(issue as Parameters<typeof z.defaultErrorMap>[0], { defaultError: "", data: undefined });
    return fallback.message === issue.message;
  } catch {
    return false;
  }
}

/** Traduit une issue Zod en phrase lisible ; garde un message déjà rédigé en français. */
export function describeIssue(issue: ZodIssueLike): string {
  if (issue.message && !looksTechnical(issue.message) && !isZodDefaultMessage(issue)) return issue.message;
  switch (issue.code) {
    case "invalid_type":
      return issue.received === "undefined" || issue.received === "null"
        ? "Ce champ est obligatoire."
        : "Le format de ce champ n'est pas valide.";
    case "too_small":
      return issue.type === "string"
        ? `Saisissez au moins ${issue.minimum} caractère${Number(issue.minimum) > 1 ? "s" : ""}.`
        : issue.type === "array"
          ? "Ajoutez au moins un élément."
          : `La valeur doit être au moins ${issue.minimum}.`;
    case "too_big":
      return issue.type === "string"
        ? `Ce champ ne doit pas dépasser ${issue.maximum} caractères.`
        : `La valeur ne doit pas dépasser ${issue.maximum}.`;
    case "invalid_string":
      return issue.validation === "email" ? "Adresse e-mail invalide." : "Le format de ce champ n'est pas valide.";
    case "invalid_enum_value":
      return "Choisissez une valeur dans la liste.";
    case "invalid_date":
      return "Date invalide.";
    default:
      return "Ce champ n'est pas valide.";
  }
}

export function toFieldErrors(issues: unknown): ApiFieldError[] | undefined {
  if (!Array.isArray(issues) || issues.length === 0) return undefined;
  return issues.map((raw) => {
    const issue = (raw ?? {}) as ZodIssueLike & { field?: string };
    const field = issue.field ?? (Array.isArray(issue.path) ? issue.path.join(".") : "");
    return { field, message: describeIssue(issue) };
  });
}
