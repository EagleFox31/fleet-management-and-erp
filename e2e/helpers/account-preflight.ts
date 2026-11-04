/**
 * Contrôle des comptes e2e avant la suite.
 *
 * Les comptes par défaut (`admin`/`admin123`, `terry`, `fatou`) n'existent que sur la base
 * décrite par `docs/qa/COMPTES_ENVIRONNEMENT.md`. Sur une autre base (base de test, recette),
 * chaque spec échouait à la connexion, une par une, et la passe ressemblait à une série de
 * défauts produit. Ce contrôle arrête la suite d'emblée, avec un message qui nomme les comptes.
 *
 * Sans dépendance à Playwright : testable en unitaire (tests/unit/e2e/account-preflight.test.ts).
 */

export interface PreflightAccount {
  username: string;
  password: string;
  label: string;
}

/** Statut HTTP de la connexion, ou `null` si le serveur n'a pas répondu. */
export type LoginProbe = (account: PreflightAccount) => Promise<number | null>;

/** Comptes refusés à la connexion (statut 401 ou 403). Un serveur muet ou en 5xx n'est pas imputé au compte. */
export async function rejectedAccounts(accounts: PreflightAccount[], probe: LoginProbe): Promise<PreflightAccount[]> {
  const unique = accounts.filter((account, index) => accounts.findIndex((a) => a.username === account.username) === index);
  const rejected: PreflightAccount[] = [];
  for (const account of unique) {
    const status = await probe(account);
    if (status === 401 || status === 403) rejected.push(account);
  }
  return rejected;
}

/** Message actionnable, sans mot de passe. */
export function rejectedAccountsMessage(rejected: PreflightAccount[]): string {
  const names = rejected.map((account) => `${account.label} (${account.username})`).join(", ");
  return (
    `Comptes e2e refusés par cette base : ${names}. ` +
    "Renseigner E2E_USERNAME / E2E_MANAGER_USERNAME / E2E_VIEWER_USERNAME et leurs *_PASSWORD " +
    "avec des comptes de cette base (recette : comptes recette_*, voir e2e/README.md). " +
    "E2E_SKIP_ACCOUNT_CHECK=1 désactive ce contrôle."
  );
}
