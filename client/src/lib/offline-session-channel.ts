import { clientLogger } from "@/lib/logger";

/**
 * Diffusion entre onglets d'un même navigateur (réserve S1) : une déconnexion faite dans
 * un onglet vide aussi l'état local des autres, et un changement de la file les prévient.
 * `BroadcastChannel` quand il existe ; sans lui, rien n'est diffusé (le contrôle
 * `/api/auth/me` avant rejeu reste la protection de fond).
 */

export type SessionChannelMessage = { type: "logout" } | { type: "queue-changed" };

export const SESSION_CHANNEL_NAME = "fleetos-offline-session";

type Handler = (message: SessionChannelMessage) => void;

export interface SessionChannel {
  post(message: SessionChannelMessage): void;
  subscribe(handler: Handler): () => void;
}

export function createSessionChannel(
  factory: ((name: string) => BroadcastChannel) | null = typeof BroadcastChannel === "undefined"
    ? null
    : (name) => new BroadcastChannel(name),
): SessionChannel {
  let channel: BroadcastChannel | null = null;
  const handlers = new Set<Handler>();

  function ensure(): BroadcastChannel | null {
    if (channel || !factory) return channel;
    try {
      channel = factory(SESSION_CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent) => {
        const data = event.data as { type?: unknown } | null;
        if (data?.type !== "logout" && data?.type !== "queue-changed") return;
        for (const handler of Array.from(handlers)) {
          try {
            handler({ type: data.type });
          } catch (err) {
            clientLogger.warn("Écouteur de session entre onglets en échec", { err });
          }
        }
      };
    } catch (err) {
      clientLogger.warn("Canal de session entre onglets indisponible", { err });
      channel = null;
    }
    return channel;
  }

  return {
    post(message) {
      try {
        ensure()?.postMessage(message);
      } catch (err) {
        clientLogger.warn("Diffusion entre onglets en échec", { err });
      }
    },
    subscribe(handler) {
      handlers.add(handler);
      ensure();
      return () => {
        handlers.delete(handler);
      };
    },
  };
}

/** Instance de l'application. */
export const sessionChannel = createSessionChannel();
