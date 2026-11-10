import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { isTrustedRequestOrigin } from "./allowed-origins";
import { moduleLogger } from "./logger";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Anti-CSRF de l'upgrade `/ws` : le cookie de session accompagne un upgrade lancé depuis n'importe
 * quel site, qui lirait ensuite les diffusions temps réel. Une `Origin` présente et non admise
 * (`server/lib/allowed-origins.ts`) détruit la socket après un 403. Retourne vrai si l'upgrade est refusé.
 */
export function rejectForeignUpgrade(request: IncomingMessage, socket: Duplex): boolean {
  const origin = first(request.headers.origin);
  const trusted = isTrustedRequestOrigin({
    origin,
    secFetchSite: first(request.headers["sec-fetch-site"]),
    host: request.headers.host,
  });
  if (trusted) return false;
  moduleLogger("websocket").warn({ origin }, "upgrade WebSocket refusé : origine non admise");
  socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  socket.destroy();
  return true;
}
