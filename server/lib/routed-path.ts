import type { Request } from "express";

/**
 * Chemin de la requete tel que le routeur Express l'a lu : base du montage (`req.baseUrl`) suivie de
 * `req.path`, que Express calcule par `parseurl` (le parseur qui choisit la route). Ce parseur retire
 * `schema://hote` d'une forme absolue, la query et le fragment, et convertit `\` en `/` quand l'URL porte
 * un `#` ou une forme absolue (`PATCH /api\users/62#x` s'execute sur `/api/users/62`). Barres repetees
 * reduites : chaque montage en absorbe une (`/api//users/62`).
 *
 * Un controle transversal qui reconnait une requete par son chemin (audit, idempotence) lit ce chemin,
 * jamais `req.originalUrl` brut : tout ecart avec le routeur est un contournement (#631).
 */
export function routedPath(req: Pick<Request, "baseUrl" | "path">): string {
  return `${req.baseUrl ?? ""}${req.path ?? ""}`.replace(/\/{2,}/g, "/") || "/";
}

/**
 * Prefixe `/api` tel que le lit le montage `app.use("/api", ...)` : insensible a la casse, segment entier.
 * `req.path.startsWith("/api")` laissait `/API/...` sans journal d'acces ni `no-store`, et prenait
 * `/apix` pour une route d'API.
 */
export const API_PREFIX = /^\/api(?=\/|$)/i;

export function isApiPath(path: string): boolean {
  return API_PREFIX.test(path);
}
