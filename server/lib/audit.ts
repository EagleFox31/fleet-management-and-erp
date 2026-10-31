import { AUDIT_MASK, type AuditAction } from "@shared/contracts/audit-logs";
import { moduleLogger } from "./logger";

const log = moduleLogger("audit");

/**
 * Cle sensible : sous-chaine, pas seulement egalite exacte (`deviceToken`, `accessToken`,
 * `apiKey`, `x-api-key`). Masquer trop vaut mieux que fuiter dans le journal.
 */
const SENSITIVE_KEY = /^(authorization|cookie)$|token|secret|password|passwd|pin|api[-_]?key/i;
export const AUDIT_MAX_BODY_BYTES = 4096;
const MAX_DEPTH = 8;

/** Copie profonde dont les cles sensibles valent AUDIT_MASK. N'altere pas l'entree. */
export function maskSecrets(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[profondeur max]";
  if (Array.isArray(value)) return value.map((v) => maskSecrets(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? AUDIT_MASK : maskSecrets(v, depth + 1);
  }
  return out;
}

/** Masque puis tronque a 4 ko : au-dela, on garde un apercu et la taille d'origine. */
export function prepareAuditBody(body: unknown): Record<string, unknown> | null {
  if (body === undefined || body === null) return null;
  const masked = maskSecrets(body);
  const json = JSON.stringify(masked) ?? "";
  if (Buffer.byteLength(json) <= AUDIT_MAX_BODY_BYTES) {
    return masked !== null && typeof masked === "object" && !Array.isArray(masked)
      ? (masked as Record<string, unknown>)
      : { value: masked };
  }
  return { truncated: true, bytes: Buffer.byteLength(json), preview: json.slice(0, AUDIT_MAX_BODY_BYTES) };
}

export interface AuditEntry {
  userId: number | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  method: string | null;
  path: string | null;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  details: Record<string, unknown> | null;
}

export type AuditSink = (entry: AuditEntry) => Promise<void>;

let sink: AuditSink | null = null;
/** Branche l'ecriture (base). Sans sink, recordAudit ne fait rien. */
export function setAuditSink(s: AuditSink | null): void {
  sink = s;
}

/** Ecriture non bloquante : une panne est journalisee, jamais propagee. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  if (!sink) return;
  try {
    await sink({ ...entry, details: entry.details ? (maskSecrets(entry.details) as Record<string, unknown>) : null });
  } catch (err) {
    log.error({ err, requestId: entry.requestId, entityType: entry.entityType }, "ecriture du journal d'audit impossible");
  }
}
