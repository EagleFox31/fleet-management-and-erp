## Réserve #86 : workflowId non entier sur le téléversement de document d'acquisition

- **Quoi** : `POST /api/workflows/:sessionId/documents` renvoyait 500 quand `workflowId` n'était pas un entier positif (`parseInt("abc")` = NaN passé à la requête SQL). Il renvoie désormais 400 « Identifiant de workflow invalide. », pour le personnel comme pour le client, sans rien écrire.
- **Comment** : validation `Number.isSafeInteger(n) && n > 0` avant la vérification d'appartenance et l'écriture (`server/routes.ts`). Cas ajouté dans `tests/contract/role-guards-pistes-def.contract.test.ts` (`abc`, `1.5`, `-3`, `0`, admin et client) : rouge prouvé sur l'ancien code (500), 16/16 vert après.
- **Pourquoi** : règle AGENTS.md §10, une entrée invalide donne un 400 lisible, jamais une erreur SQL en 500.

