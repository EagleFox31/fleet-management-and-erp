import { setupWorker } from "msw/browser";
import { createHandlers } from "./handlers";

/** Démarre le service worker msw. Appelé seulement par `enable-mocks.ts`. */
export async function startMockWorker(): Promise<void> {
  const worker = setupWorker(...createHandlers());
  await worker.start({ onUnhandledRequest: "bypass", quiet: true });
}
