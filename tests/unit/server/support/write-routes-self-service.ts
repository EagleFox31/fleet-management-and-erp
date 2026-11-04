/**
 * Routes d'écriture LIBRE-SERVICE : ouvertes à tout compte connecté, parce qu'elles n'agissent
 * que sur les données du compte de session (mot de passe, accueil, préférences, boîte d'alertes).
 * Exception explicite au cliquet T1 (tests/unit/server/write-routes-ratchet.test.ts), par route.
 *
 * Le cliquet ne lit PAS le handler pour juger du périmètre (la garde `selfScoped`, retirée de #235,
 * le faisait et chaque relecture la contournait). Il exige seulement :
 *  - `isAnyUser` sur la déclaration (le compte de session est chargé, un compte supprimé est refusé) ;
 *  - aucun identifiant de compte lu dans la requête (`FOREIGN_ID_READ` sur le texte du handler) ;
 *  - un contrat existant avec un test dont le titre contient « autre compte » et qui appelle la route
 *    (`calls` y figure tel quel) : il prouve qu'un compte A ne modifie pas les données d'un compte B.
 *    La simple présence de l'appel ne suffit pas : un test 401 la satisfaisait.
 * La preuve du périmètre est donc ce contrat. Ajouter une entrée ici est une décision de relecture :
 * la PR dit pourquoi la route n'a pas de garde de rôle et cite son contrat.
 */
export interface SelfServiceRoute {
  /** Contrat qui prouve le périmètre « compte de session seulement ». */
  contract: string;
  /** Appel de la route tel qu'écrit dans le contrat. */
  calls: string;
  /** Données touchées, toujours celles du compte de session. */
  scope: string;
}

export const SELF_SERVICE_ROUTES: Readonly<Record<string, SelfServiceRoute>> = {
  "post /api/users/change-password": {
    contract: "tests/contract/self-service-scope.contract.test.ts",
    calls: '"POST", "/api/users/change-password"',
    scope: "mot de passe du compte de session (`req.session.userId`)",
  },
  "patch /api/onboarding/step": {
    contract: "tests/contract/self-service-scope.contract.test.ts",
    calls: '"PATCH", "/api/onboarding/step"',
    scope: "ligne `user_onboarding` du compte de session",
  },
  "patch /api/onboarding/complete": {
    contract: "tests/contract/self-service-scope.contract.test.ts",
    calls: '"PATCH", "/api/onboarding/complete"',
    scope: "ligne `user_onboarding` du compte de session",
  },
  "patch /api/onboarding/mascot": {
    contract: "tests/contract/self-service-scope.contract.test.ts",
    calls: '"PATCH", "/api/onboarding/mascot"',
    scope: "ligne `user_onboarding` du compte de session",
  },
  "patch /api/notifications/settings": {
    contract: "tests/contract/notification-settings.contract.test.ts",
    calls: '"PATCH", "/api/notifications/settings"',
    scope: "préférences `notification_preferences` du compte de session ; `userId` du corps ignoré",
  },
  "post /api<relative(ALERT_READ_ALL_PATH)>": {
    contract: "tests/contract/alerts-inbox.contract.test.ts",
    calls: '"POST", ALERT_READ_ALL_PATH',
    scope: "alertes du compte de session (`alertInboxService.markAllRead(userId)`)",
  },
  'patch /api${relative(alertPath(":id"))}/read': {
    contract: "tests/contract/alerts-inbox.contract.test.ts",
    calls: '"PATCH", `${alertPath(foreign)}/read`',
    scope: "alerte du compte de session ; celle d'un autre compte répond 404",
  },
  'delete /api<relative(alertPath(":id"))>': {
    contract: "tests/contract/alerts-inbox.contract.test.ts",
    calls: '"DELETE", alertPath(foreign)',
    scope: "alerte du compte de session ; celle d'un autre compte répond 404",
  },
};

/**
 * Lecture d'un identifiant de compte venu de la requête : une route libre-service n'en a pas besoin,
 * le compte est celui de la session. Accès direct (`req.body.userId`, `req.params["ownerId"]`) ou
 * déstructuration (`const { userId } = req.body`).
 */
export const FOREIGN_ID_READ =
  /\breq\.(?:params|query|body)\s*(?:\.\s*|\[\s*["'`])(?:userId|user_id|ownerId|accountId)\b|\b(?:const|let|var)\s*\{[^{}]*\b(?:userId|user_id|ownerId|accountId)\b[^{}]*\}\s*=\s*req\.(?:params|query|body)\b/;

/** Mot exigé dans le titre du test qui prouve le périmètre. */
export const FOREIGN_ACCOUNT_TITLE = "autre compte";

/** Tests `it("...")` du contrat dont le titre parle d'un autre compte. */
function foreignAccountTests(contract: string): string[] {
  return contract
    .split(/\n\s*it\(/)
    .slice(1)
    .filter((block) => (block.split("\n")[0] ?? "").includes(FOREIGN_ACCOUNT_TITLE));
}

/** Problèmes d'une entrée libre-service : texte du handler et contrat de périmètre. Vide = conforme. */
export function selfServiceProblems(key: string, entry: SelfServiceRoute, handlerBody: string, contract: string): string[] {
  const problems: string[] = [];
  const read = FOREIGN_ID_READ.exec(handlerBody)?.[0];
  if (read) problems.push(`${key} : le handler lit un identifiant de compte de la requête (${read}) ; prends celui de la session`);
  if (contract === "") problems.push(`${key} : contrat ${entry.contract} introuvable`);
  else if (!foreignAccountTests(contract).some((block) => block.includes(entry.calls)))
    problems.push(`${key} : ${entry.contract} n'a pas de test « ${FOREIGN_ACCOUNT_TITLE} » qui appelle la route (${entry.calls})`);
  return problems;
}
