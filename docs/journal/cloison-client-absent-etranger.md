# Cloison client : l'étranger et l'absent se répondent à l'identique

## Suivi : toast de suppression d'un document de workflow

- **Quoi** : `workflow-documents-viewer.tsx`, la suppression d'un document affiche `userMessageOf(error, repli)` au lieu d'un texte fixe.
- **Pourquoi** : le serveur répond 403 à un client dont le document est absent ou étranger (décision #255, complétée par la correction des documents de workflow). Un texte fixe masquait cette réponse ; l'écran lit maintenant « Accès refusé » comme ailleurs. Le repli reste le message d'origine pour une erreur sans message.
- **Comment** : une ligne dans `onError`, import de `userMessageOf`. Le téléversement (`uploadMutation`) lève encore une erreur générique avant que la réponse soit lue : à traiter à part si l'on veut y afficher le message du serveur.
