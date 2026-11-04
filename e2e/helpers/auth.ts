import { expect, request, type APIRequestContext, type Page } from "@playwright/test";

export interface E2ECredentials {
  username: string;
  password: string;
  /** Libelle metier, utilise dans les messages d'erreur des tests. */
  label: string;
}

export interface E2EIdentity {
  id: number;
  username: string;
  name: string;
  email: string;
  role: string;
}

const defaultUsername = process.env.E2E_USERNAME || "admin";
const defaultPassword = process.env.E2E_PASSWORD || "admin123";

/** Compte principal (admin) des specs, tel que résolu depuis l'environnement. */
export const DEFAULT_CREDENTIALS: E2ECredentials = {
  username: defaultUsername,
  password: defaultPassword,
  label: "admin",
};

/**
 * Comptes multi-profils pour les scenarios inter-roles.
 *
 * Valeurs par defaut alignees sur `docs/qa/COMPTES_ENVIRONNEMENT.md`, qui est la
 * source de verite de la base Neon courante. Ne PAS reprendre les logins de
 * `scripts/seed-production-data.ts` (`workshop_manager`, `warehouse`, ...): ils
 * n'existent pas sur cet environnement, et les specs se skippaient en silence.
 */
export const MANAGER_CREDENTIALS: E2ECredentials = {
  username: process.env.E2E_MANAGER_USERNAME || "terry",
  password: process.env.E2E_MANAGER_PASSWORD || "workshop123",
  label: "chef d'atelier",
};

export const VIEWER_CREDENTIALS: E2ECredentials = {
  username: process.env.E2E_VIEWER_USERNAME || "fatou",
  password: process.env.E2E_VIEWER_PASSWORD || "warehouse123",
  label: "magasinier",
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function submitLoginForm(page: Page, username: string, password: string): Promise<boolean> {
  await page.goto("/login", { waitUntil: "domcontentloaded" });

  // Cibler par data-testid et non par texte: la page login a deja ete refondue une
  // fois (placeholders et libelle du bouton changes), ce qui avait casse toute la
  // suite e2e sans que rien ne le signale.
  await page.getByTestId("input-username").fill(username);
  await page.getByTestId("input-password").fill(password);

  // On attend la reponse d'authentification: sinon la session peut ne pas encore
  // etre posee quand le test enchaine sur une requete API.
  const [loginResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/auth/login") && response.request().method() === "POST",
    ),
    page.getByTestId("button-submit-login").click(),
  ]);

  return loginResponse.ok();
}

export async function login(
  page: Page,
  username: string = defaultUsername,
  password: string = defaultPassword,
): Promise<void> {
  await submitLoginForm(page, username, password);

  // Selon le contexte, la redirection peut atterrir sur la landing ou directement le dashboard.
  await expect(page).toHaveURL(/\/(|landing|dashboard)$/);
}

export async function loginAndOpen(page: Page, path: string): Promise<void> {
  await login(page);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp(`${escapeRegex(path)}(?:\\?.*)?$`));
  await expect(page).not.toHaveURL(/\/login$/);
}

/**
 * Connecte un profil donne et retourne son identite serveur.
 * Retourne `null` si le compte n'existe pas ou si le mot de passe est refuse:
 * l'appelant decide alors de skipper le scenario avec un message explicite.
 */
/**
 * Connexion purement API, sans navigateur.
 *
 * Pour un test de droits ou de contrat d'API, charger l'application React coûte
 * plusieurs minutes par profil; passer par `POST /api/auth/login` prend quelques
 * secondes. Mesuré sur un test 3 profils: 6 min 40 -> 18 s.
 *
 * Le contexte retourné conserve le cookie de session: on enchaîne directement
 * `ctx.post(...)`, `ctx.patch(...)`. Penser à `ctx.dispose()` en fin de test.
 *
 * Utiliser `loginAs` à la place dès qu'il faut observer l'écran (temps réel,
 * rendu, navigation).
 */
export async function apiLogin(
  credentials: E2ECredentials,
  baseURL: string = process.env.E2E_BASE_URL || "http://127.0.0.1:5000",
): Promise<APIRequestContext | null> {
  const context = await request.newContext({ baseURL });
  const response = await context.post("/api/auth/login", {
    data: { username: credentials.username, password: credentials.password },
  });

  if (!response.ok()) {
    await context.dispose();
    return null;
  }

  return context;
}

/**
 * Connexion par l'API dans le contexte du navigateur.
 *
 * `page.request` partage les cookies du contexte : la page ouverte ensuite est
 * déjà connectée, sans passer par l'écran de connexion (une navigation de 7 à
 * 17 s en moins en dev). Réservé aux specs qui ne testent pas la connexion.
 */
export async function loginWithSession(page: Page, credentials: E2ECredentials): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { username: credentials.username, password: credentials.password },
  });
  expect(response.ok(), `connexion ${credentials.label} (${credentials.username})`).toBeTruthy();
}

export async function loginAs(
  page: Page,
  credentials: E2ECredentials,
): Promise<E2EIdentity | null> {
  const submitted = await submitLoginForm(page, credentials.username, credentials.password);
  if (!submitted) {
    return null;
  }

  const meResponse = await page.request.get("/api/auth/me");
  if (!meResponse.ok()) {
    return null;
  }

  return (await meResponse.json()) as E2EIdentity;
}
