import type { IncomingMessage, Server } from "http";
import type { WebSocketServer } from "ws";
import { moduleLogger } from "./logger";
import { upgradeRoute } from "./upgrade-route";
import { rejectForeignUpgrade } from "./ws-origin";
import { sessionMiddleware } from "../middleware/session";
import { findActiveSessionUser } from "../services/session-user";

export interface WsConnectionMeta {
  userId: number;
  role: string | null;
  /** Session HTTP qui a ouvert la socket (pour garder ouverte celle qui reste valide). */
  sessionId?: string;
}

export interface WsSessionRequest extends IncomingMessage {
  sessionID?: string;
  session?: { userId?: number };
  wsMeta?: WsConnectionMeta;
}

export const toPositiveInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

/**
 * Upgrade HTTP vers /ws : origine, session, relecture du compte, puis `wss.handleUpgrade`.
 * Extrait de server/index.ts pour être monté tel quel par les tests.
 */
export function attachWsUpgrade(
  server: Server,
  wss: WebSocketServer,
  isDevelopment: boolean,
  lookupUser: typeof findActiveSessionUser = findActiveSessionUser,
): void {
  server.on('upgrade', (request, socket, head) => {
    const route = upgradeRoute(request.url, isDevelopment);
    if (route !== "app") {
      if (route === "reject") socket.destroy();
      return;
    }

    if (rejectForeignUpgrade(request, socket)) return;

    const mockResponse = {
      getHeader: () => undefined,
      setHeader: () => undefined,
      end: () => undefined,
      writeHead: () => undefined,
    };

    sessionMiddleware(request as any, mockResponse as any, (sessionError?: unknown) => {
      if (sessionError) {
        moduleLogger("websocket").error({ err: sessionError }, "Erreur session sur upgrade WebSocket");
        socket.write("HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      const sessionRequest = request as WsSessionRequest;
      const sessionUserId = toPositiveInteger(sessionRequest.session?.userId);
      if (!sessionUserId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      // Le rôle est relu en base, comme dans `authenticate` : celui de la session
      // est figé à la connexion et survivrait à un changement de rôle (ADM2-3).
      lookupUser(sessionUserId)
        .then((user) => {
          if (!user) {
            socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
            socket.destroy();
            return;
          }

          sessionRequest.wsMeta = {
            userId: sessionUserId,
            role: typeof user.role === "string" ? user.role : null,
            sessionId: typeof sessionRequest.sessionID === "string" ? sessionRequest.sessionID : undefined,
          };

          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
          });
        })
        .catch((err: unknown) => {
          moduleLogger("websocket").error({ err, userId: sessionUserId }, "Relecture du compte impossible sur upgrade WebSocket");
          socket.write("HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n");
          socket.destroy();
        });
    });
  });
}
