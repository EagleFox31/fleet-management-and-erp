## d4f928c - PATCH pièce, pneu, panne, pneu monté (T3, T4)

**Quoi**
- PATCH pièce : champs d'audit du corps ignorés, 400 par champ, 404 pièce inconnue,
  409 référence en double, plus de texte d'erreur brut.
- PATCH pneu : `ZodError` -> 400 ; panne du catalogue et pneu monté : `prepareColumnUpdate`.

**Comment**
- Tests de contrat écrits d'abord : 6 rouges (500 partout), puis verts.
- Les deux erreurs métier connues du service pièce (message texte) sont traduites
  en `AppError` avec le bon statut ; tout le reste devient 500 générique journalisé.

**Pourquoi**
- La route renvoyait `error.message` au client, y compris une erreur SQL (interdit, AGENTS.md §10).
- Le client pouvait réécrire `createdBy` / `createdAt` d'une fiche pièce (traçabilité stock, AGENTS.md §5).
- Incident : LESSONS_LEARNED « PATCH pièce : texte d'erreur exposé et champs d'audit modifiables ».

