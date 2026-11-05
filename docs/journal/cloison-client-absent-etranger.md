# Cloison client : l'étranger et l'absent se répondent à l'identique

## Suivi : toast de suppression d'un document de workflow

- **Quoi** : `workflow-documents-viewer.tsx`, la suppression d'un document affiche `userMessageOf(error, repli)` au lieu d'un texte fixe.
- **Pourquoi** : le serveur répond 403 à un client dont le document est absent ou étranger (décision #255, complétée par la correction des documents de workflow). Un texte fixe masquait cette réponse ; l'écran lit maintenant « Accès refusé » comme ailleurs. Le repli reste le message d'origine pour une erreur sans message.
- **Comment** : une ligne dans `onError`, import de `userMessageOf`. Le téléversement (`uploadMutation`) lève encore une erreur générique avant que la réponse soit lue : à traiter à part si l'on veut y afficher le message du serveur.

## Import de documents d'acquisition : message du serveur

- **Quoi** : `uploadFile` (`client/src/lib/api.ts`) lève `toApiError(response)` au lieu d'une `Error` portant le corps brut, et l'écran `pages/workflows/vehicle-acquisition.tsx` affiche `userMessageOf(error, repli)` dans son `catch`. `WorkflowDocumentsViewer`, qu'aucun module n'importait (vérifié par `git grep`, imports dynamiques compris), est supprimé.
- **Pourquoi** : l'écran réellement utilisé affichait un texte fixe quel que soit le refus du serveur (403 de cloison, validation). #408 avait corrigé un composant mort ; le correctif portait donc sur un écran jamais affiché. Le message du serveur est maintenant lu là où l'utilisateur importe ses documents.
- **Comment** : `toApiError` dans `uploadFile` (les autres appelants, `vehicle-documents.tsx`, lisent déjà `userMessageOf`), `catch (error)` dans `handleDocumentSelect`, le `console.error` migré vers `clientLogger`. Test `tests/unit/client/upload-file-error.test.ts` : rouge sans le correctif (le message contient le JSON brut), vert avec.
## Reponse HTML sur une route /api : message sans jargon

- **Quoi** : `apiRequest` leve un message fixe (`INVALID_API_RESPONSE_MESSAGE`) et envoie la route et l'extrait HTML a `clientLogger`.
- **Pourquoi** : l'ancien message portait l'URL et l'extrait, et passait `looksTechnical` pour s'afficher tel quel. Test : `tests/unit/client/query-client-html-response.test.ts`.
## Message hors périmètre neutre (#410)

- **Quoi** : `OUT_OF_SCOPE_MESSAGE` ne nomme plus le véhicule ; `GET /api/vehicles/:id` garde son texte historique (e2e 24).
- **Pourquoi** : la même réponse sert à l'objet étranger et à l'identifiant absent, le message ne doit donc rien dire de l'objet.

## Garde du balayage : une route ouverte à un client ne peut plus y échapper

- **Quoi** : `scanClientOpenParamRoutes` (`tests/support/route-guard-scan.ts`) liste les routes `isAnyUser` à paramètre ; `tests/unit/server/client-scope-sweep-guard.test.ts` échoue si l'une n'est ni au balayage (`tests/support/client-scope-sweep-table.ts`), ni couverte par un contrat nommé, ni exclue avec sa raison (liste plafonnée à 1).
- **Comment** : la table du balayage est partagée entre le contrat et la garde. Les lignes 200 comparent aussi le corps. Ligne ajoutée : `GET /api/users/:id` (403 pour un profil étranger comme pour un absent).
- **Pourquoi** : sans garde, une route ajoutée ouverte à un client pouvait répondre autrement pour l'objet d'un autre et pour un absent. Mutation prouvée : une route `isAnyUser` fictive dans `routes.ts` fait échouer le test. Limite : seule la garde écrite dans l'en-tête de la route est vue.

## La garde voit les gardes de montage et de routeur

- **Quoi** : `scanClientOpenParamRoutes` retient toute route à paramètre qui porte une garde de session sans garde restrictive, qu'elle vienne de l'en-tête, de `router.use(...)` posé avant la route ou du montage (`server/api/index.ts`). Même contexte de gardes que `scanOpenGetReads` (`guardContext`). Passe de 20 à 30 routes ; 7 manquaient à la table (justificatif de renouvellement, coûts de maintenance, 5 écritures de workflow), désormais au balayage ou couvertes par un contrat nommé.
- **Comment** : `staleRows` signale toute ligne de la table qui ne correspond plus à une route ouverte ; le fragment d'un contrat nommé doit se terminer sur le délimiteur du littéral (chemin exact). Cas synthétiques : `router.use(isAnyUser)`, `authenticate` en en-tête, montage `isStaff`, garde en en-tête restrictive, `use` posé après la route.
- **Pourquoi** : la première garde ne voyait que `isAnyUser` écrit dans l'en-tête ; une route ouverte par `router.use` ou `authenticate` y échappait. Échec fermé : une garde inconnue compte comme permissive.

## Limites restantes de l'échec fermé (relecture #429)

- **Quoi** : une garde inconnue posée par `router.use(...)` compte désormais comme permissive (route retenue), comme en en-tête ; seuls les sous-routeurs sont ignorés. Le balayage de statut 400 n'est accepté que pour la ligne `maintenance-cost`.
- **Limites connues** (backlog) : un `router.use(isStaff)` placé dans un `if` est compté comme inconditionnel (route écartée à tort) ; un chemin en gabarit `${}` ou un appel illisible est ignoré au lieu d'être retenu ; un second routeur non monté hérite des gardes du premier ; l'égalité étranger = absent n'est pas prouvée pour les écritures de workflow couvertes ailleurs.
## Contrôles de fuite : angles morts de la garde fermés

- **Quoi** : `tests/unit/leak-check-hygiene.test.ts` détecte maintenant `expect` sur plusieurs lignes (virgule finale), `JSON.stringify(corps, null, 2)`, `String(corps)`, `res.text` / `await res.text()`, et le contrôle en deux temps (`const t = ...; expect(t).not...`), pour `.not.toMatch` comme `.not.toContain`.
- **Comment** : une aiguille n'est dangereuse que si elle est courte (moins de 5 caractères) et faite de caractères d'un `requestId` (lettres, chiffres, `_`, `-`) ; `%PDF` ou un chemin ne le sont pas. Cas positifs et négatifs au test. Le balayage du dépôt a trouvé un seul vrai cas (`"4821"` dans admin-patch-user-pin), passé par `leakText`.
- **Pourquoi** : la première garde ne voyait que `JSON.stringify(x)).not.toMatch` sur une ligne. Limite : une aiguille passée par une variable n'est pas évaluée.

## Reliquat de #429 : trois angles du scan fermés, r2 prouvé

- `router.use(garde)` posé dans un `if`, une boucle, un ternaire ou après `&&`/`||` n'est plus compté comme inconditionnel (`isConditionalAt`).
- Un chemin de route en gabarit (`${}` -> `:p`) ou illisible (appel, variable) est retenu sous son texte, jamais ignoré. Les 3 routes d'alertes construites par `relative(alertPath(...))` sont inscrites en « couvert ailleurs » (`alerts-inbox`), avec `exact` pour un fragment qui ne finit pas sur un guillemet.
- Un second routeur du fichier (non exporté) ne reprend plus le montage d'un autre : `mountOf`. Il n'est retenu que s'il porte sa propre garde de session.
- r2 : pour les 4 PATCH du brouillon d'acquisition et POST des documents, statut, message et code de l'objet d'un autre client sont identiques à ceux d'un identifiant absent (contrat, 22/22).
- Preuves par mutation : retirer `isConditionalAt`, le traitement des gabarits ou `mountOf` fait échouer respectivement 1, 2 et 9 tests.
