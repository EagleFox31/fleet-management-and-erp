/**
 * Activation des mocks : développement uniquement ET variable explicite
 * `VITE_API_MOCKS=1`. En production `import.meta.env.DEV` vaut `false` à la
 * compilation : la branche est morte et le `import()` n'est pas émis.
 */
export function mocksRequested(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_API_MOCKS === "1";
}

export async function enableMocksIfRequested(): Promise<void> {
  if (!mocksRequested()) return;
  const { startMockWorker } = await import("./browser");
  await startMockWorker();
}
