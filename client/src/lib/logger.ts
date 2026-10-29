/**
 * Journal côté navigateur, pour le développeur (console), jamais pour l'écran.
 *
 * - En développement : tout est affiché, contexte compris.
 * - En production : avertissements et erreurs seulement, sur une ligne, avec
 *   la référence `requestId` qui permet de retrouver la trace dans les logs
 *   serveur.
 * - Les 50 dernières entrées restent consultables (`window.__fleetLogs`) pour
 *   un diagnostic à distance sans outil supplémentaire.
 */

type Level = "debug" | "info" | "warn" | "error";
type Entry = { at: string; level: Level; message: string; context?: Record<string, unknown> };

const BUFFER_SIZE = 50;
const buffer: Entry[] = [];
const isDev = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

function write(level: Level, message: string, context?: Record<string, unknown>) {
  const entry: Entry = { at: new Date().toISOString(), level, message, context };
  buffer.push(entry);
  if (buffer.length > BUFFER_SIZE) buffer.shift();

  if (!isDev && (level === "debug" || level === "info")) return;
  const method = level === "debug" ? "debug" : level;
  // eslint-disable-next-line no-console
  console[method](`[fleetmaster] ${message}`, ...(context ? [context] : []));
}

export const clientLogger = {
  debug: (message: string, context?: Record<string, unknown>) => write("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => write("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => write("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => write("error", message, context),
  recent: (): readonly Entry[] => buffer.slice(),
};

if (typeof window !== "undefined") {
  (window as unknown as { __fleetLogs?: () => readonly Entry[] }).__fleetLogs = clientLogger.recent;
}
