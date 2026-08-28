import { createServer } from "http";
import type { Express } from "express";

export async function requestJson(
  app: Express,
  method: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
