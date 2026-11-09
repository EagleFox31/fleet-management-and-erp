## a20b181 - Contrat d'erreur centralisé et logger structuré

**Quoi**
- Contrat `ApiErrorBody { message, code, requestId, errors? }` (`shared/errors.ts`).
- `AppError` (`server/lib/app-error.ts`) et gestionnaire central
  (`server/middleware/error-handler.ts`).
- Logger pino `moduleLogger` (`server/lib/logger.ts`) ; `clientLogger` et
  `userMessageOf` côté navigateur (`client/src/lib/api-error.ts`).

**Comment**
- Le gestionnaire central normalise toute réponse >= 400, y compris les anciens
  `res.status(400).json({ message })` des routes : pas de réécriture route par route.
- Une 5xx affiche un message générique + « Référence : <requestId> » ; le détail ne
  part qu'aux logs, retrouvable par ce `requestId`.

**Pourquoi**
- Des messages techniques (SQL, stack) arrivaient dans les toasts.
- Un utilisateur qui signale une erreur peut donner une référence exploitable.
- Incident : LESSONS_LEARNED « Erreurs techniques affichées, logs supprimés ».

