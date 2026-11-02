import { createServer, type Server } from "http";
import { expect } from "vitest";
import { getContractApp } from "./app";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "./factories";

/**
 * Serveur HTTP in-process + un compte connecté par rôle, pour les tests de contrat.
 * `actors` : nom de l'acteur -> rôle ; `userIds` reçoit les comptes créés (à supprimer en fin de suite).
 */
export type ContractResponse = { status: number; body: any; headers: Headers };

export async function startContractActors<A extends string>(actors: Record<A, TestUserRole>, userIds: number[]) {
  const app = await getContractApp();
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const cookies = new Map<A, string>();
  const ownIds = new Map<A, number>();

  for (const [actor, role] of Object.entries(actors) as [A, TestUserRole][]) {
    const user = await createTestUser({ role });
    userIds.push(user.id);
    ownIds.set(actor, user.id);
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
    });
    expect(res.status).toBe(200);
    cookies.set(actor, res.headers.get("set-cookie")!.split(";")[0]);
  }

  async function call(method: string, path: string, options: { body?: unknown; actor?: A } = {}): Promise<ContractResponse> {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.actor ? { Cookie: cookies.get(options.actor)! } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body, headers: response.headers };
  }

  return {
    call,
    baseUrl,
    cookies,
    userIdOf: (actor: A) => ownIds.get(actor)!,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
