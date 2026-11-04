import pino from "pino";

/**
 * Journal applicatif unique du serveur.
 *
 * - JSON une ligne par événement : lisible par `grep`, exploitable par un
 *   collecteur (Render, Datadog, Loki…) sans changer le code.
 * - `LOG_LEVEL` (trace, debug, info, warn, error, silent) ; `info` par défaut,
 *   `silent` sous Vitest pour garder les sorties de test lisibles.
 * - Les secrets ne sortent jamais : mots de passe, cookies, jetons sont masqués.
 *
 * Usage : `const log = moduleLogger("part-requirements"); log.error({ err, id }, "…")`.
 * Le premier argument porte le contexte, le second une phrase courte.
 */

const defaultLevel = process.env.VITEST ? "silent" : "info";

/**
 * Options pino partagées (exportées pour être testées sur un flux capturé).
 * `err.detail` / `err.where` : Postgres y recopie la ligne refusée (« Failing row contains (…) »,
 * « Key (col)=(valeur) »), donc un PIN, un hash ou un e-mail ; jamais journalisés.
 */
export const loggerOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || defaultLevel,
  base: { service: "fleetmaster" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "password",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.secret",
      "req.headers.cookie",
      "req.headers.authorization",
      "headers.cookie",
      "headers.authorization",
      "err.detail",
      "*.err.detail",
      "err.where",
      "*.err.where",
    ],
    censor: "[masqué]",
  },
  serializers: { err: pino.stdSerializers.err },
};

export const logger = pino(loggerOptions);

export type Logger = typeof logger;

export function moduleLogger(module: string): Logger {
  return logger.child({ module });
}
