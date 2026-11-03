import { basename } from "node:path";
import { hostname } from "node:os";
import { Client, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

/**
 * Verrou de la base de test, tenu en base (pg_advisory_lock) pendant tout un passage vitest
 * (intégration ou contrat). Deux passages sur la même base s'enchaînent, quelle que soit l'URL qui
 * la désigne (`localhost:54320` et `postgres:5432` sont la même base locale) et sans dépendre d'un
 * script à penser à lancer.
 *
 * - Clé : `hashtext('<namespace>:' || current_database())`, donc même base = même verrou.
 * - Le verrou appartient à une connexion dédiée, ouverte jusqu'au globalTeardown : si le processus
 *   meurt, Postgres ferme la session et libère le verrou, sans fichier périmé à nettoyer.
 * - Attente lisible : `pg_try_advisory_lock` en boucle, avec le détenteur (pid, application, depuis).
 * - Délai maximal : `FLEET_TEST_DB_LOCK_TIMEOUT_MS` (30 min par défaut), puis échec actionnable.
 *
 * En CI, chaque job a sa propre base : le verrou est pris immédiatement, sans effet.
 */

export const TEST_DB_LOCK_NAMESPACE = "fleet-test";
export const DEFAULT_LOCK_TIMEOUT_MS = 30 * 60 * 1000;
const APP_PREFIX = "fleet-test-lock";

export interface TestDbLock {
  /** pid du backend Postgres qui tient le verrou. */
  pid: number;
  release(): Promise<void>;
}

export interface AcquireOptions {
  connectionString: string;
  namespace?: string;
  timeoutMs?: number;
  pollMs?: number;
  /** Reporté dans `application_name`, pour que celui qui attend sache qui tient le verrou. */
  owner?: string;
  log?: (message: string) => void;
}

export function lockTimeoutFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.FLEET_TEST_DB_LOCK_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_LOCK_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`FLEET_TEST_DB_LOCK_TIMEOUT_MS invalide (« ${raw} ») : attendu un nombre de millisecondes ≥ 0.`);
  }
  return value;
}

export function defaultLockOwner(): string {
  return `${hostname()} pid ${process.pid} ${basename(process.cwd())}`;
}

function configureDriver() {
  neonConfig.webSocketConstructor = ws;
  if (process.env.DATABASE_WS_PROXY) {
    neonConfig.wsProxy = process.env.DATABASE_WS_PROXY;
    neonConfig.useSecureWebSocket = false;
    neonConfig.pipelineConnect = false;
  }
}

/** Un verrou de session ne tient pas derrière le pooler Neon (mode transaction) : connexion directe. */
function directConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    url.hostname = url.hostname.replace("-pooler.", ".");
    return url.toString();
  } catch {
    return connectionString;
  }
}

interface Holder {
  pid: number;
  application: string;
  since: string;
}

const KEY_SQL = "hashtext($1 || ':' || current_database())::bigint";

async function currentHolder(client: Client, namespace: string): Promise<Holder | null> {
  // Clé bigint d'un verrou consultatif à un argument : classid = 32 bits hauts, objid = 32 bits bas.
  const { rows } = await client.query(
    `WITH k AS (SELECT ${KEY_SQL} AS key)
     SELECT l.pid, COALESCE(a.application_name, '') AS application,
            to_char(COALESCE(a.backend_start, now()), 'YYYY-MM-DD HH24:MI:SS TZ') AS since
       FROM pg_locks l
       JOIN k ON l.classid::bigint = ((k.key >> 32) & 4294967295) AND l.objid::bigint = (k.key & 4294967295)
       LEFT JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory' AND l.objsubid = 1 AND l.granted
        AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
      LIMIT 1`,
    [namespace],
  );
  if (rows.length === 0) return null;
  return { pid: Number(rows[0].pid), application: String(rows[0].application), since: String(rows[0].since) };
}

function describeHolder(holder: Holder | null): string {
  if (!holder) return "détenteur inconnu";
  const who = holder.application ? `, ${holder.application}` : "";
  return `pid ${holder.pid}${who}, depuis ${holder.since}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function acquireTestDbLock(options: AcquireOptions): Promise<TestDbLock> {
  const namespace = options.namespace ?? TEST_DB_LOCK_NAMESPACE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const pollMs = options.pollMs ?? 2000;
  const log = options.log ?? ((message: string) => console.warn(message));
  const owner = options.owner ?? defaultLockOwner();

  configureDriver();
  const client = new Client({
    connectionString: directConnectionString(options.connectionString),
    application_name: `${APP_PREFIX} ${owner}`.slice(0, 63),
  } as ConstructorParameters<typeof Client>[0]);
  await client.connect();

  try {
    const started = Date.now();
    let lastReport = 0;
    for (;;) {
      const { rows } = await client.query(`SELECT pg_try_advisory_lock(${KEY_SQL}) AS ok`, [namespace]);
      if (rows[0]?.ok === true) break;

      const holder = await currentHolder(client, namespace);
      const waited = Date.now() - started;
      if (waited >= timeoutMs) {
        throw new Error(
          [
            `Verrou de la base de test non obtenu après ${Math.round(waited / 1000)} s (${describeHolder(holder)}).`,
            "Un autre passage d'intégration ou de contrat écrit sur cette base. Attendez qu'il se termine et relancez,",
            holder
              ? `ou, si cette session est morte : SELECT pg_terminate_backend(${holder.pid}); sur la base de test.`
              : "ou vérifiez pg_locks sur la base de test.",
            "Pour attendre plus longtemps : FLEET_TEST_DB_LOCK_TIMEOUT_MS=<millisecondes>.",
          ].join("\n"),
        );
      }
      if (lastReport === 0 || Date.now() - lastReport >= 60000) {
        log(`en attente du verrou de test (${describeHolder(holder)})`);
        lastReport = Date.now();
      }
      await sleep(Math.min(pollMs, Math.max(0, timeoutMs - waited)));
    }
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }

  const { rows } = await client.query("SELECT pg_backend_pid() AS pid");
  const pid = Number(rows[0].pid);
  // Une connexion inactive longtemps peut être fermée par un proxy : un ping la garde vivante, et
  // une perte est signalée (le verrou tombe avec elle).
  const keepAlive = setInterval(() => {
    client.query("SELECT 1").catch((err) => log(`verrou de test perdu : connexion fermée (${(err as Error).message})`));
  }, 30000);
  keepAlive.unref();
  let released = false;

  return {
    pid,
    async release() {
      if (released) return;
      released = true;
      clearInterval(keepAlive);
      try {
        await client.query(`SELECT pg_advisory_unlock(${KEY_SQL})`, [namespace]);
      } finally {
        await client.end().catch(() => {});
      }
    },
  };
}
