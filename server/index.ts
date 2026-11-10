import os from 'os';
import type { IncomingMessage } from "http";
import { randomUUID } from "crypto";
import { setupVite, serveStatic } from "./vite";
import { startBackgroundJobs } from "./scheduler";
import { listenerPool, pool } from "./db";
import type { PoolClient } from "@neondatabase/serverless";
import { WebSocketServer, WebSocket } from 'ws';
import { sessionMiddleware } from "./middleware/session";
import { findActiveSessionUser } from "./services/session-user";
import { moduleLogger } from "./lib/logger";
import { upgradeRoute } from "./lib/upgrade-route";
import { rejectForeignUpgrade } from "./lib/ws-origin";
import { relayDatabaseEvent } from "./lib/db-event-relay";
import { createApp } from "./app";
import { setAuditSink } from "./lib/audit";
import { dbAuditSink } from "./lib/audit-db-sink";
import { describeInvalidScope, normalizeScope, resolveRecipients } from "./lib/realtime-scope";

(async () => {
  const { app, server } = await createApp();

  // Tâches de fond (cycle d'alertes). Démarrées ici, pas depuis routes.ts.
  startBackgroundJobs();

  // Configuration WebSocket pour données temps réel
  // noServer: true pour ne pas intercepter les upgrades du HMR Vite
  const wss = new WebSocketServer({ noServer: true });

  interface WsConnectionMeta {
    userId: number;
    role: string | null;
    /** Session HTTP qui a ouvert la socket (pour garder ouverte celle qui reste valide). */
    sessionId?: string;
  }

  interface WsSessionRequest extends IncomingMessage {
    sessionID?: string;
    session?: {
      userId?: number;
    };
    wsMeta?: WsConnectionMeta;
  }

  interface DatabaseRealtimeMessage {
    source?: string;
    version?: number;
    entity?: string;
    entityId?: number | string | null;
    eventType?: string;
    payload?: unknown;
    emittedAt?: string;
  }

  const toPositiveInteger = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value;
    }
    return null;
  };

  // Router manuellement les upgrades : /ws → app, reste → Vite HMR en développement, refus sinon.
  const isDevelopment = app.get("env") === "development";
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
      findActiveSessionUser(sessionUserId)
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

  const inferEntityFromEvent = (event: string): string => {
    if (event.startsWith("work_order")) return "work_order";
    if (event.startsWith("vehicle")) return "vehicle";
    if (event.startsWith("purchase_order")) return "purchase_order";
    if (event.startsWith("supplier")) return "supplier";
    if (event.startsWith("client_invoice")) return "client_invoice";
    if (event.startsWith("part")) return "part";
    if (event.startsWith("warehouse")) return "warehouse";
    if (event.startsWith("fuel_card")) return "fuel_card";
    if (event.startsWith("alert")) return "alert";
    if (event.startsWith("fuel")) return "fuel_record";
    return "system";
  };

  // Stockage des connexions actives (multi-onglets supportés)
  const activeConnections = new Map<number, Set<WebSocket>>();
  const activeRoleConnections = new Map<string, Set<WebSocket>>();
  const connectionMeta = new Map<WebSocket, WsConnectionMeta>();

  const addConnection = (ws: WebSocket, meta: WsConnectionMeta): void => {
    connectionMeta.set(ws, meta);

    const userSockets = activeConnections.get(meta.userId) ?? new Set<WebSocket>();
    userSockets.add(ws);
    activeConnections.set(meta.userId, userSockets);

    if (meta.role) {
      const normalizedRole = meta.role.trim().toLowerCase();
      if (normalizedRole) {
        const roleSockets = activeRoleConnections.get(normalizedRole) ?? new Set<WebSocket>();
        roleSockets.add(ws);
        activeRoleConnections.set(normalizedRole, roleSockets);
      }
    }
  };

  const removeConnection = (ws: WebSocket): void => {
    const meta = connectionMeta.get(ws);
    if (!meta) {
      return;
    }

    const userSockets = activeConnections.get(meta.userId);
    if (userSockets) {
      userSockets.delete(ws);
      if (userSockets.size === 0) {
        activeConnections.delete(meta.userId);
      }
    }

    if (meta.role) {
      const normalizedRole = meta.role.trim().toLowerCase();
      const roleSockets = activeRoleConnections.get(normalizedRole);
      if (roleSockets) {
        roleSockets.delete(ws);
        if (roleSockets.size === 0) {
          activeRoleConnections.delete(normalizedRole);
        }
      }
    }

    connectionMeta.delete(ws);
  };

  const isUserOnline = (userId: number): boolean => {
    const userSockets = activeConnections.get(userId);
    if (!userSockets || userSockets.size === 0) {
      return false;
    }

    for (const ws of userSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        return true;
      }
    }

    return false;
  };

  const getOnlineUserIds = (): number[] => {
    const onlineUserIds: number[] = [];
    activeConnections.forEach((_sockets, userId) => {
      if (isUserOnline(userId)) {
        onlineUserIds.push(userId);
      }
    });
    return onlineUserIds;
  };

  // `keepSessionId` : les sockets de cette session HTTP restent ouvertes (changement de mot de passe).
  const closeUserConnections = (userId: number, reason: string = "logout", keepSessionId?: string): void => {
    const userSockets = activeConnections.get(userId);
    if (!userSockets || userSockets.size === 0) {
      return;
    }

    Array.from(userSockets).forEach((ws) => {
      if (keepSessionId && connectionMeta.get(ws)?.sessionId === keepSessionId) return;
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, reason);
        }
      } catch (error) {
        moduleLogger("websocket").error({ err: error, userId }, "Erreur fermeture socket utilisateur");
      }
    });
  };

  (global as any).isUserOnline = isUserOnline;
  (global as any).getOnlineUserIds = getOnlineUserIds;
  (global as any).closeUserConnections = closeUserConnections;
  
  wss.on('connection', (ws, req) => {
    const wsRequest = req as WsSessionRequest;
    const wsMeta = wsRequest.wsMeta;
    if (!wsMeta) {
      ws.close(1008, "Unauthorized");
      return;
    }

    addConnection(ws, wsMeta);
    console.log(`Nouvelle connexion WebSocket établie (user: ${wsMeta.userId}, role: ${wsMeta.role ?? "unknown"})`);
    ws.send(JSON.stringify({
      type: "auth_success",
      message: "Synchronisation temps réel activée",
      userId: wsMeta.userId,
      role: wsMeta.role,
      timestamp: new Date().toISOString(),
    }));
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString()) as Record<string, unknown>;
        const dataType = typeof data?.type === "string" ? data.type : "";

        // Compat rétro: ne jamais faire confiance au userId envoyé par le client
        if (dataType === 'auth') {
          const claimedUserId = toPositiveInteger(data.userId);
          if (claimedUserId && claimedUserId !== wsMeta.userId) {
            console.warn(
              `WebSocket auth mismatch ignoré: client=${claimedUserId}, session=${wsMeta.userId}`,
            );
          }

          ws.send(JSON.stringify({
            type: 'auth_success',
            message: 'Synchronisation temps réel activée',
            userId: wsMeta.userId,
            role: wsMeta.role,
            timestamp: new Date().toISOString(),
          }));
          return;
        }

        if (dataType === 'ping') {
          ws.send(JSON.stringify({
            type: 'pong',
            timestamp: new Date().toISOString(),
          }));
          return;
        }
      } catch (error) {
        console.error('Erreur parsing message WebSocket:', error);
      }
    });
    
    ws.on('close', () => {
      const meta = connectionMeta.get(ws);
      removeConnection(ws);
      if (meta) {
        console.log(`Connexion WebSocket fermée pour utilisateur ${meta.userId}`);
      }
    });
  });
  
  // Fonction globale pour diffuser les mises à jour
  (global as any).broadcastUpdate = (event: string, data: any, userId: number | null = null) => {
    const eventData = data && typeof data === "object" ? data : {};
    const {
      eventId: eventIdOverride,
      version: versionOverride,
      correlationId: correlationIdOverride,
      causationId: causationIdOverride,
      tenantId: tenantIdOverride,
      actor: actorOverride,
      scope: scopeOverride,
      entity: entityOverride,
      entityId: entityIdOverride,
      emittedAt: emittedAtOverride,
      payload: payloadOverride,
      ...payloadFallback
    } = eventData;

    const eventId = typeof eventIdOverride === "string" ? eventIdOverride : randomUUID();
    const emittedAt =
      typeof emittedAtOverride === "string"
        ? emittedAtOverride
        : new Date().toISOString();
    const payload = payloadOverride ?? payloadFallback;
    const entity = typeof entityOverride === "string" ? entityOverride : inferEntityFromEvent(event);
    const entityId =
      entityIdOverride ??
      payloadFallback.workOrderId ??
      payloadFallback.vehicleId ??
      payloadFallback.partId ??
      payloadFallback.alertId ??
      null;
    const scope = normalizeScope(scopeOverride, userId);
    if (!scope) {
      // Fermé par défaut : sans portée valide, l'événement ne part à personne.
      moduleLogger("websocket").warn(
        { event, entity, scope: describeInvalidScope(scopeOverride) },
        "Événement temps réel ignoré : portée absente ou invalide (un broadcast doit être demandé explicitement)",
      );
      return;
    }
    const actor =
      actorOverride ??
      (payloadFallback.triggeredBy
        ? { userId: Number(payloadFallback.triggeredBy) || null }
        : null);
    const message = JSON.stringify({
      eventId,
      version: typeof versionOverride === "number" ? versionOverride : 1,
      type: event,
      entity,
      entityId,
      payload,
      scope,
      actor,
      correlationId: correlationIdOverride ?? eventId,
      causationId: causationIdOverride ?? null,
      tenantId: tenantIdOverride ?? null,
      emittedAt,
      // Compat rétro: anciens consommateurs lisent data/timestamp
      data: payload,
      timestamp: emittedAt,
    });

    const recipients = resolveRecipients(scope, { byUser: activeConnections, byRole: activeRoleConnections });

    recipients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  };

  // Listener DB temps réel : remonte les changements DB (même hors API) vers le WS
  let dbListenerClient: PoolClient | null = null;
  let dbReconnectTimeout: ReturnType<typeof setTimeout> | undefined;
  let dbReconnectAttempt = 0;

  const clearDbReconnectTimeout = (): void => {
    if (dbReconnectTimeout) {
      clearTimeout(dbReconnectTimeout);
      dbReconnectTimeout = undefined;
    }
  };

  const releaseDbListenerClient = (client: PoolClient): void => {
    client.removeAllListeners("notification");
    client.removeAllListeners("error");
    client.removeAllListeners("end");
    try {
      client.release();
    } catch (releaseError) {
      console.error("[DB-EVENTS] Erreur release client LISTEN:", releaseError);
    }
  };

  const scheduleDbReconnect = (): void => {
    if (dbReconnectTimeout) {
      return;
    }

    dbReconnectAttempt += 1;
    const exponentialDelay = Math.min(30_000, 1000 * 2 ** Math.min(dbReconnectAttempt, 5));
    const jitter = Math.floor(Math.random() * 500);

    dbReconnectTimeout = setTimeout(() => {
      dbReconnectTimeout = undefined;
      void connectDatabaseEventBridge();
    }, exponentialDelay + jitter);
  };

  const parseDatabaseRealtimeMessage = (payload: string): DatabaseRealtimeMessage | null => {
    try {
      const parsed = JSON.parse(payload);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      return parsed as DatabaseRealtimeMessage;
    } catch (error) {
      console.error("[DB-EVENTS] Payload JSON invalide:", error);
      return null;
    }
  };

  const connectDatabaseEventBridge = async (): Promise<void> => {
    if (dbListenerClient) {
      return;
    }

    try {
      const client = await listenerPool.connect();
      dbListenerClient = client;
      dbReconnectAttempt = 0;
      clearDbReconnectTimeout();

      await client.query("LISTEN fleet_events");
      console.log("[DB-EVENTS] LISTEN fleet_events actif");

      client.on("notification", (message) => {
        if (message.channel !== "fleet_events" || typeof message.payload !== "string") {
          return;
        }

        const parsed = parseDatabaseRealtimeMessage(message.payload);
        if (!parsed || typeof parsed.eventType !== "string") {
          return;
        }

        const logged = parsed.payload && typeof parsed.payload === "object" ? (parsed.payload as Record<string, unknown>) : {};
        moduleLogger("db-events").info(
          { eventType: parsed.eventType, entityId: parsed.entityId ?? logged.workOrderId ?? logged.vehicleId ?? null },
          "événement de base reçu",
        );

        // Portées : voir `server/lib/db-event-relay.ts` (personnel, coûts d'OT, propriétaire du véhicule).
        void relayDatabaseEvent(parsed, {
          broadcast: (event, data) => (global as any).broadcastUpdate(event, data),
          inferEntity: inferEntityFromEvent,
        }).catch((err) => {
          moduleLogger("db-event-relay").error({ err, eventType: parsed.eventType }, "relais d'un événement de base en échec");
        });
      });

      client.on("error", (error) => {
        console.error("[DB-EVENTS] Erreur listener:", error);
        if (dbListenerClient === client) {
          dbListenerClient = null;
          releaseDbListenerClient(client);
          scheduleDbReconnect();
        }
      });

      client.on("end", () => {
        console.warn("[DB-EVENTS] Connexion LISTEN interrompue, reconnexion...");
        if (dbListenerClient === client) {
          dbListenerClient = null;
          releaseDbListenerClient(client);
          scheduleDbReconnect();
        }
      });
    } catch (error) {
      console.error("[DB-EVENTS] Impossible d'initialiser LISTEN fleet_events:", error);
      if (dbListenerClient) {
        releaseDbListenerClient(dbListenerClient);
      }
      dbListenerClient = null;
      scheduleDbReconnect();
    }
  };

  void connectDatabaseEventBridge();

  const shutdownDbEventBridge = (): void => {
    clearDbReconnectTimeout();
    if (!dbListenerClient) {
      return;
    }

    const client = dbListenerClient;
    dbListenerClient = null;
    client.query("UNLISTEN fleet_events").catch(() => undefined);
    releaseDbListenerClient(client);
  };

  let isShuttingDown = false;

  const gracefulShutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    console.log(`\n[SHUTDOWN] Signal ${signal} reçu, arrêt en cours...`);

    shutdownDbEventBridge();

    const forceExitTimer = setTimeout(() => {
      console.error("[SHUTDOWN] Timeout dépassé, arrêt forcé.");
      process.exit(1);
    }, 7000);
    forceExitTimer.unref();

    try {
      wss.clients.forEach((clientSocket) => {
        try {
          if (clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.close(1001, "server_shutdown");
          }
        } catch {
          // no-op
        }
      });

      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    } catch (error) {
      console.error("[SHUTDOWN] Erreur fermeture WebSocket:", error);
    }

    await new Promise<void>((resolve) => {
      server.close((error) => {
        if (error) {
          console.error("[SHUTDOWN] Erreur fermeture serveur HTTP:", error);
        }
        resolve();
      });
    });

    await Promise.allSettled([
      listenerPool.end(),
      pool.end(),
    ]);

    clearTimeout(forceExitTimer);
    console.log("[SHUTDOWN] Arrêt terminé.");
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void gracefulShutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void gracefulShutdown("SIGTERM");
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Port 5000 par défaut (API et client sur le même port); PORT permet de
  // lancer l'app à côté d'un autre service qui occupe déjà 5000.
  setAuditSink(dbAuditSink);

  const port = Number(process.env.PORT) || 5000;
  server.listen(port, "0.0.0.0", () => {
    const networkInterfaces = os.networkInterfaces();
    let networkUrl = '';
    for (const iface of Object.values(networkInterfaces)) {
      if (!iface) continue;
      for (const addr of iface) {
        if (addr.family === 'IPv4' && !addr.internal) {
          networkUrl = `http://${addr.address}:${port}`;
          break;
        }
      }
      if (networkUrl) break;
    }
    console.log('');
    console.log('  FleetMaster 2.0 - Dev Server');
    console.log('');
    console.log(`  Local:   http://localhost:${port}`);
    if (networkUrl) console.log(`  Network: ${networkUrl}`);
    console.log('');
  });
})();
