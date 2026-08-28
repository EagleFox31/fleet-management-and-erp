import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
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

  const hasJsonBody = isBodyJsonSerializable(body);
  const serializedBody =
    typeof body === "string"
      ? body
      : hasJsonBody
        ? JSON.stringify(body)
        : (body as BodyInit | null | undefined);

  const res = await fetch(url, {
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
    throw new Error(
      `Réponse API invalide (HTML) pour ${method} ${url}. Vérifiez la route backend et redémarrez le serveur. Aperçu: ${htmlPreview}`,
    );
  }

  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // Récupère l'URL de base et les paramètres
    const baseUrl = queryKey[0] as string;
    const params = queryKey[1] as Record<string, any> | undefined;
    
    // Construit l'URL avec les paramètres
    let url = baseUrl;
    if (params) {
      const searchParams = new URLSearchParams();
      
      // Ajoute uniquement les paramètres qui ne sont pas undefined
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      });
      
      // Ajoute les paramètres à l'URL si au moins un paramètre existe
      const searchString = searchParams.toString();
      if (searchString) {
        url = `${baseUrl}?${searchString}`;
      }
      
      console.log("URL de requête complète:", url);
    }
    
    const res = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    // Some browsers can still serve conditional responses in dev; force a hard fetch.
    if (res.status === 304) {
      const separator = url.includes("?") ? "&" : "?";
      const freshRes = await fetch(`${url}${separator}_ts=${Date.now()}`, {
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
      staleTime: 5 * 60 * 1000, // Données fraîches pendant 5 minutes
      gcTime: 10 * 60 * 1000, // Cache pendant 10 minutes
      refetchOnWindowFocus: false, // Pas de rafraîchissement sur focus
      refetchOnMount: true, // Rafraîchir lors du montage seulement
      refetchOnReconnect: false, // Pas de rafraîchissement sur reconnexion
      refetchInterval: false, // Pas de rafraîchissement automatique
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
