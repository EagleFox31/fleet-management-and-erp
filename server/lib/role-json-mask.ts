import type { NextFunction, Request, RequestHandler, Response } from "express";
import { moduleLogger } from "./logger";

const log = moduleLogger("role-json-mask");

/**
 * Middleware de masquage par rôle des réponses JSON des GET (et HEAD) d'un montage.
 *
 * `res.json` est enveloppé : le rôle est lu à l'envoi, après la garde de la route (`req.user`,
 * ou relecture du compte quand la garde est `authenticate` seul). Sans session, ou si le compte
 * est introuvable ou illisible, la réponse est masquée (refus par défaut). PDF et fichiers ne
 * passent pas par `res.json` et ne sont pas touchés.
 *
 * `redact(role, body)` renvoie le corps tel quel pour un rôle autorisé, une copie masquée sinon.
 */
export function roleJsonMask(redact: (role: string | null, body: unknown) => unknown, label: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // HEAD : Express passe par la même route, `Content-Length` doit refléter le corps masqué.
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const json = res.json.bind(res);
    res.json = ((body?: unknown) => {
      if (req.user) return json(redact(req.user.role, body));
      const sessionUserId = req.session?.userId;
      if (typeof sessionUserId !== "number") return json(redact(null, body));
      import("../services/session-user")
        .then(({ findActiveSessionUser }) => findActiveSessionUser(sessionUserId))
        .then((user) => redact(user?.role ?? null, body))
        .catch((err) => {
          log.error({ err, requestId: req.requestId }, `Relecture du rôle pour le masquage : ${label}`);
          return redact(null, body);
        })
        .then((out) => json(out))
        .catch(next);
      return res;
    }) as typeof res.json;
    next();
  };
}
