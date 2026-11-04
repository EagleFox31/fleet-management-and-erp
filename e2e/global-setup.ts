import { chromium, request, type FullConfig } from "@playwright/test";
import { DEFAULT_CREDENTIALS, MANAGER_CREDENTIALS, VIEWER_CREDENTIALS } from "./helpers/auth";
import { rejectedAccounts, rejectedAccountsMessage } from "./helpers/account-preflight";

/**
 * Préchauffage du serveur de développement.
 *
 * En mode dev, Vite compile l'application à la première requête. Sur ce projet
 * (270+ fichiers front, pages de plus de 100 Ko) cette compilation dépasse
 * 60 secondes — soit le timeout par test. Résultat: le premier test qui touchait
 * l'application échouait systématiquement, et le diagnostic pointait à tort vers
 * la spec plutôt que vers la compilation.
 *
 * Mesuré après préchauffage: 7 à 17 secondes par navigation.
 *
 * Ce setup charge la page de connexion une fois, hors de tout test, avec un
 * délai large. Les tests démarrent donc à chaud.
 *
 * Inutile contre un build de production (`npm run build && npm start`), où rien
 * n'est compilé à la volée — mais inoffensif.
 */
async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    process.env.E2E_BASE_URL ||
    config.projects[0]?.use?.baseURL ||
    "http://127.0.0.1:5000";

  const startedAt = Date.now();
  const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL || undefined });

  try {
    const page = await browser.newPage();
    await page.goto(`${baseURL}/login`, {
      waitUntil: "domcontentloaded",
      timeout: 180_000,
    });
    // Attendre que le formulaire soit réellement monté: `domcontentloaded`
    // arrive avant que React ait fini de rendre.
    await page.getByTestId("input-username").waitFor({ timeout: 180_000 });

    console.log(`[e2e] Préchauffage terminé en ${Date.now() - startedAt} ms`);
  } catch (error) {
    // Ne pas faire échouer la suite ici: si le serveur est injoignable, les
    // tests le diront avec un message plus utile que celui du préchauffage.
    console.warn(
      `[e2e] Préchauffage échoué après ${Date.now() - startedAt} ms:`,
      error instanceof Error ? error.message : error,
    );
  } finally {
    await browser.close();
  }

  // Comptes absents de la base visée : arrêter la suite ici plutôt que de laisser chaque spec
  // échouer à la connexion (voir e2e/helpers/account-preflight.ts).
  if (process.env.E2E_SKIP_ACCOUNT_CHECK !== "1") {
    const api = await request.newContext({ baseURL });
    try {
      const rejected = await rejectedAccounts(
        [DEFAULT_CREDENTIALS, MANAGER_CREDENTIALS, VIEWER_CREDENTIALS],
        async (account) => {
          try {
            const response = await api.post("/api/auth/login", {
              data: { username: account.username, password: account.password },
              timeout: 60_000,
            });
            return response.status();
          } catch {
            return null;
          }
        },
      );
      if (rejected.length > 0) throw new Error(rejectedAccountsMessage(rejected));
    } finally {
      await api.dispose();
    }
  }
}

export default globalSetup;
