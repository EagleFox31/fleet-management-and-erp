import type { RequestHandler } from "express";
import { AppError } from "../lib/app-error";

/** Barre oblique inverse brute (`\`), jamais envoyee par un navigateur ni par le client de l'app. */
const BACKSLASH = String.fromCharCode(92);

/** Cible en forme absolue (`PATCH http://hote/api/... HTTP/1.1`), que Node accepte. */
const ABSOLUTE_FORM = /^[a-z][a-z0-9+.-]*:\/\//i;

export const NON_CANONICAL_TARGET_CODE = "NON_CANONICAL_TARGET";

/** Vrai si la cible brute serait lue differemment par l'app et par un routeur monte. */
export function isNonCanonicalTarget(rawTarget: string): boolean {
  if (ABSOLUTE_FORM.test(rawTarget)) return true;
  return rawTarget.split("?")[0].includes(BACKSLASH);
}

/**
 * Refuse en 400, avant tout routage, une cible que les couches liraient differemment.
 *
 * `parseurl` (Express) convertit `\` en `/` quand la cible porte un `#` ou une forme absolue, mais un
 * montage (`app.use("/api", apiRouter)`) retire son prefixe de la cible brute : pour `/api\users/62#x`,
 * l'app lit `/api/users/62` et apiRouter lit `//users/62`. Les gardes declarees dans `server/api/`
 * (dernier admin, vehicule retire, audit, idempotence) ne se declenchaient pas, et la route de
 * `server/routes.ts`, declaree sur l'app, s'executait. La forme absolue, inutile a un client legitime,
 * est refusee pour la meme raison. Restent acceptes : `\` dans la query, `%5C` (jamais converti).
 */
export const rejectNonCanonicalTarget: RequestHandler = (req, _res, next) => {
  if (!isNonCanonicalTarget(req.url)) return next();
  next(new AppError(400, "Adresse de requête invalide.", { code: NON_CANONICAL_TARGET_CODE }));
};
