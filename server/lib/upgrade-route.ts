/**
 * Destination d'un upgrade HTTP (WebSocket) recu par le serveur.
 * - `/ws` : temps reel de l'app ;
 * - autre chemin en developpement : laisse a Vite HMR, qui ecoute le meme serveur ;
 * - autre chemin hors developpement : personne n'ecoute, la socket doit etre detruite, sinon elle
 *   reste ouverte sans reponse.
 */
export type UpgradeRoute = "app" | "vite" | "reject";

export function upgradeRoute(url: string | undefined, isDevelopment: boolean): UpgradeRoute {
  if (url?.split("?")[0] === "/ws") return "app";
  return isDevelopment ? "vite" : "reject";
}
