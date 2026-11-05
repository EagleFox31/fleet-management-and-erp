import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { toApiError } from "@/lib/api-error";
import { clientLogger } from "@/lib/logger";

/** Message affiché quand une route `/api` répond une page HTML au lieu de JSON. */
export const INVALID_API_RESPONSE_MESSAGE = "Le serveur a renvoyé une réponse inattendue. Réessayez dans un instant.";

/**
 * Résout les URLs d'API relatives en URLs complètes lorsque l'application s'exécute
 * dans un wrapper natif Android APK (Capacitor) ou dans un environnement multi-origines.
 */
export function resolveApiUrl(path: string): string {
  if (
    !path ||
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("blob:") ||
    path.startsWith("data:")
  ) {
    return path;
  }

  const apiBase =
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) ||
    (typeof window !== "undefined" && (window as any).__FLEETOS_API_URL__) ||
    "";

  const normalizedBase = apiBase.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return normalizedBase ? `${normalizedBase}${normalizedPath}` : normalizedPath;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    throw await toApiError(res);
  }
}

type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

const API_METHODS: Set<string> = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

function isMethod(value: string): value is ApiMethod {
  return API_METHODS.has(value.toUpperCase());
}

function isBodyJsonSerializable(body: unknown): boolean {
  if (body == null) return false;
  if (typeof body === "string") return true;
  if (body instanceof FormData) return false;
  if (body instanceof URLSearchParams) return false;
  if (body instanceof Blob) return false;
  return true;
}

function buildHeaders(
  headers: HeadersInit | undefined,
  hasJsonBody: boolean,
): HeadersInit | undefined {
  const merged = new Headers(headers);
  if (hasJsonBody && !merged.has("Content-Type")) {
    merged.set("Content-Type", "application/json");
  }
  return merged;
}

export function apiRequest(method: string, url: string, data?: unknown): Promise<Response>;
export function apiRequest(url: string, method: string, data?: unknown): Promise<Response>;
export function apiRequest(
  url: string,
  init?: Omit<RequestInit, "body"> & { body?: unknown },
): Promise<Response>;
export async function apiRequest(
  a: string,
  b?: string | (Omit<RequestInit, "body"> & { body?: unknown }),
  c?: unknown,
): Promise<Response> {
  let method = "GET";
  let url = "";
  let body: unknown = undefined;
  let init: Omit<RequestInit, "body"> & { body?: unknown } = {};

  // Signature: apiRequest("METHOD", "/api/...", data?)
  if (typeof b === "string" && isMethod(a) && !isMethod(b)) {
    method = a.toUpperCase();
    url = b;
    body = c;
    // Signature: apiRequest("/api/...", "METHOD", data?)
  } else if (typeof b === "string" && isMethod(b)) {
    method = b.toUpperCase();
    url = a;
    body = c;
    // Signature: apiRequest("/api/...", { method, body, ... })
  } else if (typeof b === "object" && b !== null) {
    url = a;
    init = b;
    method = (b.method || "GET").toUpperCase();
    body = b.body;
    // Signature: apiRequest("/api/...")
  } else {
    url = a;
  }

  const resolvedUrl = resolveApiUrl(url);
  const hasJsonBody = isBodyJsonSerializable(body);
  const serializedBody =
    typeof body === "string"
      ? body
      : hasJsonBody
        ? JSON.stringify(body)
        : (body as BodyInit | null | undefined);

  const res = await fetch(resolvedUrl, {
    ...init,
    method,
    headers: buildHeaders(init.headers, hasJsonBody),
    body: serializedBody,
    cache: init.cache ?? "no-store",
    credentials: init.credentials ?? "include",
  });

  await throwIfResNotOk(res);

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (url.startsWith("/api") && contentType.includes("text/html")) {
    const htmlPreview = (await res.text()).replace(/\s+/g, " ").slice(0, 160);
    // Le détail (route, extrait HTML) part au journal ; l'écran reçoit un message sans jargon.
    clientLogger.error("Réponse API invalide (HTML)", { method, url, status: res.status, htmlPreview });
    throw new Error(INVALID_API_RESPONSE_MESSAGE);
  }

  return res;
}

/**
 * URL d'une clé de query pour la queryFn par défaut (#285).
 *
 * `[url, ...segments, params?]` : les chaînes et les nombres qui suivent l'URL deviennent des
 * segments de chemin (encodés), et le premier objet devient la chaîne de requête. Ce qui le suit
 * est ignoré. `null`, `undefined`, booléens et chaînes vides sont sautés, comme avant.
 * Avant #285, seul `queryKey[1]` était lu, comme objet : `['/api/vehicles', 5]` appelait la liste.
 */
export function buildQueryUrl(queryKey: readonly unknown[]): string {
  let path = String(queryKey[0]);
  let params: Record<string, unknown> | undefined;
  for (const segment of queryKey.slice(1)) {
    if (typeof segment === "string" || typeof segment === "number") {
      if (segment !== "") path += `/${encodeURIComponent(String(segment))}`;
      continue;
    }
    if (segment !== null && typeof segment === "object") {
      params = segment as Record<string, unknown>;
      break;
    }
  }
  if (!params) return path;

  // Ajoute uniquement les paramètres qui ne sont pas undefined
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) searchParams.append(key, String(value));
  });
  const searchString = searchParams.toString();
  return searchString ? `${path}?${searchString}` : path;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = buildQueryUrl(queryKey);

    const resolvedUrl = resolveApiUrl(url);

    const res = await fetch(resolvedUrl, {
      credentials: "include",
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    // Some browsers can still serve conditional responses in dev; force a hard fetch.
    if (res.status === 304) {
      const separator = resolvedUrl.includes("?") ? "&" : "?";
      const freshRes = await fetch(`${resolvedUrl}${separator}_ts=${Date.now()}`, {
        credentials: "include",
        cache: "no-store",
      });
      await throwIfResNotOk(freshRes);
      return await freshRes.json();
    }

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      networkMode: "offlineFirst", // Sert instantanément les données en cache si déconnecté
      staleTime: 5 * 60 * 1000, // Données fraîches pendant 5 minutes
      gcTime: 24 * 60 * 60 * 1000, // Conserve le cache 24h
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      refetchOnReconnect: "always",
      refetchInterval: false,
      retry: 1,
    },
    mutations: {
      networkMode: "offlineFirst",
      retry: false,
    },
  },
});
