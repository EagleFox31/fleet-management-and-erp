/**
 * Handlers msw (T-09b) générés depuis la table `MOCK_ROUTES`.
 * Chaque réponse de succès est validée par le schéma du contrat avant envoi :
 * une donnée simulée qui s'écarte du contrat échoue ici, pas dans l'écran.
 */
import { http, HttpResponse, type HttpHandler } from "msw";
import { createMockStore, type MockStore } from "./fixtures";
import { MOCK_ROUTES, errorReply, type MockRoute, type MockScenario } from "./routes";

function scenarioOf(url: URL): MockScenario {
  return url.searchParams.get("mockScenario") === "empty" ? "empty" : "normal";
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function toHandler(route: MockRoute, store: MockStore): HttpHandler {
  return http[route.method](route.path, async ({ request, params }) => {
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const reply = route.handle({
      params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      query,
      body: request.method === "GET" ? undefined : await readBody(request),
      store,
      scenario: scenarioOf(url),
    });
    const status = reply.status ?? 200;
    if (status < 400) {
      const checked = route.response.safeParse(reply.body);
      if (!checked.success) {
        const failure = errorReply(500, "INTERNAL", "Donnée simulée non conforme au contrat.");
        return HttpResponse.json(failure.body as object, { status: 500 });
      }
    }
    return HttpResponse.json(reply.body as object, { status });
  });
}

export function createHandlers(store: MockStore = createMockStore()): HttpHandler[] {
  return MOCK_ROUTES.map((route) => toHandler(route, store));
}
