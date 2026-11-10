/**
 * Variables d'environnement qu'un fichier de contrat a le droit de changer pour lui seul.
 * Les contrats tournent en `isolate: false` : sans restauration, une valeur fixée au chargement d'un
 * fichier (`process.env.FEATURE_FLAGS = "incidents=on"`) reste en place pour les fichiers suivants.
 */
export const FILE_SCOPED_ENV = ["FEATURE_FLAGS", "TZ", "TRUST_PROXY", "AUTH_IP_FAILURE_MAX", "NODE_ENV"] as const;

export type EnvSnapshot = Record<string, string | undefined>;

export function snapshotEnv(keys: readonly string[], env: NodeJS.ProcessEnv = process.env): EnvSnapshot {
  return Object.fromEntries(keys.map((key) => [key, env[key]]));
}

/** Remet chaque clé à sa valeur de l'instantané ; une clé absente est supprimée, pas mise à "undefined". */
export function restoreEnv(snapshot: EnvSnapshot, env: NodeJS.ProcessEnv = process.env): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
}
