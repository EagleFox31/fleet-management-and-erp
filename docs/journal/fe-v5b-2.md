# Journal fe-v5b-2

## 2026-11-10 - V5b-2 : cœur de la file d'écritures différées hors ligne

- Quoi : file v2 par compte (IndexedDB), générique et partagée avec #10c. Chaque envoi porte une clé d'idempotence créée une fois (jamais régénérée), un état `pending | sending | rejected`, un compteur de tentatives et un message d'erreur lisible. Registre déclaratif des types (`offline-action-registry.ts`). Rejeu au retour du réseau, à la connexion et à la demande, un seul onglet à la fois, ordre strict avec arrêt au premier échec réessayable. Déconnexion bloquée avec choix explicite « Supprimer N envois ». Aucun écran métier branché, tout derrière `offline-writes` (et `driver-offline` pour le plein), drapeaux éteints par défaut.
- Comment : `offline-queue-core.ts` (logique pure, dépendances injectées), `offline-queue.ts` (branchement réseau, drapeaux, QueryClient, état observable), `offline-locks.ts` (Web Locks, bail localStorage en repli), `offline-replay-gate.ts` (le resync temps réel attend la fin du rejeu, puis un seul resync forcé), `offline-session-channel.ts` (déconnexion propagée aux autres onglets), `offline-kv.ts` (adaptateur idb-keyval sorti de `offline-storage.ts` pour éviter un cycle). `apiRequest` reçoit un 4e paramètre `{ headers, signal }` sur ses signatures positionnelles. Classement : 2xx ou `Idempotent-Replayed` = fait ; 409 `IDEMPOTENCY_IN_PROGRESS` = plus tard ; 401 = arrêt, file gardée ; réseau, 5xx, 408, 429 = attente exponentielle, même clé ; autre 4xx = « À revoir », ni rejoué ni supprimé.
- Pourquoi : l'ancien rejeu renvoyait sans clé (doublon possible si la réponse était perdue), sans ordre garanti, supprimait ou gardait sans distinguer un refus définitif d'une panne, et invalidait tout le cache. Réserves R2 et S1 de `cdc-ecarts.md:93` : la file ne se rejoue que si `/api/auth/me` rend son propriétaire, et la déconnexion ne détruit jamais en silence.
- Tester : `tests/unit/client/offline-queue-core.test.ts` (classement, FIFO + arrêt, clé stable, 401, rejeté, compte changé, purge, verrou, migration), `offline-replay-gate.test.ts` (barrière, registre, en-têtes d'`apiRequest`), `offline-storage-scope.test.ts` et `offline-storage-session.test.ts` (purge complète, drapeaux).
- Décision à confirmer : le changement de compte sans déconnexion détruit maintenant la file de l'ancien compte (S1), alors que l'ancien test documentait « tablette partagée : file gardée ». L'ancien comportement reste le défaut des options de `purgeAll` / `purgeOthers` ; seul le cycle de vie applicatif passe `dropQueues` / `dropOtherQueues`.

## 2026-11-10 - V5b-2 : trace de la destruction d une file (S1 validé)

- Quoi : la destruction d une file par changement de compte ou déconnexion consigne le nombre d envois détruits et leur répartition par type d écriture (clé du registre). Plus d identifiant de compte dans cette trace.
- Comment : summarizeQueued dans offline-user-scope.ts, utilisé par purgeAll et purgeOthers.
- Pourquoi : la cloison prime, mais une perte d envois ne doit être ni silencieuse ni exposer de contenu.
- Tester : offline-storage-scope.test.ts, test changement de compte (règle S1) : file détruite, trace avec nombre et types, ni charge utile, ni e-mail, ni identifiant.

## 2026-11-10 17:30 - V5b-2b : propriétaire par envoi et routes protégées

**Quoi.** En-tête `X-Offline-Owner` à chaque envoi, garde serveur 409 `OFFLINE_OWNER_MISMATCH`, `session-changed` entre onglets, routes protégées en source partagée, refus de rejeu hors motif, mineurs de la revue (plafond 409, rétention, clé, délai, `/api/`, compteur, purge des bases).

**Comment.** Voir `docs/qa/journal/2026-11-10T1730-v5b-2b-proprietaire-et-routes.md`.

**Pourquoi.** Réserves de la revue sécurité de #645 : cookie partagé entre onglets, registre qui rejouait des routes non protégées.

**Tester.** Tests unitaires `tests/unit/client/offline-*.test.ts` ; contrat `tests/contract/offline-owner-guard.contract.test.ts` sous verrou.
