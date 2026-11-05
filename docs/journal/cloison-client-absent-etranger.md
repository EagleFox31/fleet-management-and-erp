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
