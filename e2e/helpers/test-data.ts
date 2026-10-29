import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../../tests/support/factories";
import type { CreatedIds } from "../../tests/support/cleanup";
import type { E2ECredentials } from "./auth";

/**
 * Données de test des specs e2e qui écrivent en base.
 *
 * On réutilise les fabriques et le ménage de `tests/support` (préfixe `TEST-`,
 * suppression par id en fin de spec) plutôt que des comptes et des factures
 * existants : une facture partagée finit soldée par les rejeux, et les comptes
 * de recette n'existent pas sur toutes les bases. Il n'existe pas d'API publique
 * pour créer une facture client avec un solde connu.
 *
 * Exige `DATABASE_URL` dans l'environnement du runner Playwright
 * (`node --env-file=.env node_modules/@playwright/test/cli.js test ...`) : la même
 * base que celle du serveur testé.
 */
export async function createE2EUser(role: TestUserRole, ids: CreatedIds): Promise<E2ECredentials & { id: number }> {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  return { id: user.id, username: user.username, password: TEST_USER_PASSWORD, label: role };
}
