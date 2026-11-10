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

## 2026-11-10 18:00 - V5b-2b : audit sécurité et relecture (0aaaa7c2, fa78e0e5 et suite)

- Quoi : 0aaaa7c2 (livraison V5b-2b et garde de préfixe), fa78e0e5 (`routeExample` dans le test de barrière), puis CORS des en-têtes d'idempotence, route de l'envoi liée à son type, date de création par défaut, plafond 409 dérivé du délai de reprise serveur, abonnement `session-changed` testé, repli `AbortSignal.timeout`, test de rétention exact, prérequis d'allumage dans le plan.
- Comment et pourquoi : voir `docs/qa/journal/2026-11-10T1800-v5b-2b-audit-securite-suite.md`.
- Tester : tests unitaires `tests/unit/client/offline-*.test.ts` ; contrat `tests/contract/offline-owner-guard.contract.test.ts` sous verrou.

## 2026-11-10 18:45 - V5b-3b : restauration de la lecture hors ligne au démarrage

**Quoi.**
- Marqueur `offline-resume` (`client/src/lib/offline-resume.ts`) dans sa propre base IndexedDB `fleetos-offline-resume`, hors du préfixe des caches de lecture. Contenu : `version, userId, profile, lastOnlineAt, expiresAt, maxSeenAt, flags`. Aucun jeton, cookie, identifiant de session, email ni nom.
- Écrit après chaque `/api/auth/me` ou connexion réussis (`recordOfflineResume`), échéance repoussée seulement par une réponse RÉSEAU de `/api/feature-flags` ou `/api/auth/me` (`isContactProof`, `refreshOfflineResume`, au plus une fois par minute, tout de suite à l'arrivée des drapeaux). Une lecture quelconque ou une copie servie par IndexedDB ne prolonge rien. Jamais repoussée hors ligne.
- Démarrage : `session-check` « unreachable » sans `httpStatus` (réseau coupé ou délai, pas un 401/403/5xx) et aucun compte actif : `resumeOfflineRead` lit le marqueur, active le compte et restaure SA copie de lecture (marquée périmée). Lecture seule : la file d'envois n'est PAS rejouée tant que `/api/auth/me` n'a pas confirmé la session dans cette page (`isOfflineSessionConfirmed`, exigé par `replayOfflineQueue`, donc par tous les chemins de rejeu) ; aucun drapeau d'écriture touché.
- Profil : `OfflineReadProfile` gagne `roles` et `resumeOffline` (chauffeur oui, technicien non). Aucun `if role`.
- Purge du marqueur : déconnexion, changement d'utilisateur, 401 sur le `/me` du démarrage ET sur la vérification du propriétaire avant rejeu de la file (`checkOwner`), `session-changed` d'un autre onglet, `/me` d'un autre compte ou d'un rôle sans profil, expiration constatée, drapeau éteint reçu en ligne (suppression immédiate à l'écriture ou au rafraîchissement).
- Bandeau : « Hors ligne, données du X, session hors ligne jusqu'au Y ».

**Pourquoi.** Sans trace persistante de l'utilisateur actif, un démarrage sans réseau ne restaurait rien. Le cookie reste l'unique preuve d'identité ; le marqueur n'est qu'une autorisation locale bornée à 72 h après le dernier contact.

**Tester.** `node node_modules/vitest/vitest.mjs run tests/unit/client --reporter=dot` (fichiers `offline-resume*.test.ts`, `session-resume-offline.test.ts`, `session-check.test.ts`).

**Notes.** Le drapeau « offline-read » du brief n'existe pas : le marqueur garde `driver-offline` et `offline-writes`, tous deux requis. Après restauration, l'écran d'accueil attend encore `/me` (affichage du tableau de bord hors ligne : lot suivant).

**Suite (décision 0a, déconnexion sans réseau).**
- À la déconnexion, le marqueur est supprimé en premier (`purgeOfflineSession`, avant `postLogout`) : purge IndexedDB locale, indépendante du réseau.
- Si la suppression IndexedDB échoue : pierre tombale `fleetos-offline-resume-revoked` dans localStorage, contenu `{ userId }` seulement. Elle bloque toute restauration (`read`, `peek`, `touch`). Le démarrage suivant retente la purge du marqueur et lève la pierre si elle aboutit. Une connexion en ligne réussie (`record`) remplace le marqueur et lève aussi la pierre, y compris celle d'un autre compte. Même mécanisme sur 401.
- Tests : `offline-resume-storage.test.ts`, bloc « pierre tombale » (rouge constaté : 6 échecs sans le correctif, puis vert).

**Audit sécurité de 0a et relecture fonctionnelle (corrections).**
- C1 : un compte rouvert depuis le marqueur est « non confirmé » (`markOfflineSessionUnconfirmed` avant `setActiveOfflineUserId`). `replayOfflineQueue` refuse tout rejeu (événement `online`, écouteur de connexion, minuterie, bouton) tant que `/me` ou une connexion n'a pas appelé `activateOfflineUser` (confirmation, puis rattrapage du rejeu). Commentaire de `resumeOfflineRead` corrigé. Test : `offline-resume-replay.test.ts` (rouge : 2 échecs sans la garde).
- C2 : `checkSession` sépare le parse JSON du fetch : une 200 non JSON ou une redirection renvoie `unreachable` AVEC `httpStatus`, donc jamais de restauration.
- (a) Recul d'horloge : `maxSeenAt` ne fait que monter (contact réseau, lecture hors ligne), ne repousse jamais `expiresAt` ; refus si `now < maxSeenAt - 5 min`. Risque résiduel assumé : sans heure de confiance hors ligne, un recul avant la première lecture hors ligne suivant le dernier contact reste invisible ; il est borné par les 72 h de l'échéance, fixée par le dernier contact réseau.
- (b) Course avec le logout d'un autre onglet : compteur de génération relevé avant `offlineResume.read`, incrémenté par déconnexion, expiration et changement de compte ; la reprise s'abandonne s'il a bougé.
- (c) Double échec de purge : `purgeOfflineSession` renvoie faux si le marqueur ou les magasins n'ont pas pu être purgés ; `createLogout` garde alors le repère de déconnexion même si le POST réussit, et `resumeSession` le remet et ne restaure rien.
- (d) Bandeau : le marqueur doit appartenir au compte actif (`resumeDeadlineFor`) et l'échéance est appliquée par minuterie pendant que l'appli tourne. Le hook n'est pas rendu en test (pas de bibliothèque de rendu dans le dépôt) : la décision est pure et testée.
- Journal : déplacé de `docs/qa/journal/` vers ce fichier (la suite du lot V5b-2) ; `journal-fragments.test.ts` ne vérifie que le format des fragments, il n impose pas l emplacement.

## Entrées complétées après coup (relecture de #682)

Les trois entrées suivantes manquaient au journal de ce lot ; elles décrivent des commits déjà livrés.

### 0d4a2e84 : un 200 JSON qui n'est pas un utilisateur donne `unreachable`

- Quoi : `checkSession` ne rend `authenticated` que si le corps est un utilisateur (`id` entier supérieur à 0). Un `{}`, un `null` ou un `id` absent donne `unreachable` avec `httpStatus: 200`.
- Pourquoi : `useAuth` aurait fait `setUser({})` sur un 200 inexploitable (portail captif, proxy), et `httpStatus` présent interdit toute restauration hors ligne sur une réponse HTTP.
- Tester : `node node_modules/vitest/vitest.mjs run tests/unit/client/session-check.test.ts`.

### 1cf04755 : retour du réseau après une déconnexion à purge incomplète

- Quoi : `pendingLogout.flush({ beforeClear })` refait la purge locale (`purgeOfflineSession`) AVANT d'effacer le repère de déconnexion ; si elle échoue encore (faux ou exception), le repère reste et l'issue est `pending`. Le même contrôle vaut sur le chemin 401 du POST de déconnexion.
- Pourquoi : un retour du réseau effaçait le repère alors que la purge locale n'avait pas abouti : des données du compte sorti restaient sur l'appareil sans plus de trace à retenter.
- Tester : `tests/unit/client/pending-logout-purge.test.ts`, `online-after-incomplete-logout.test.ts`.

### Décision : purger un autre compte vide aussi ses files d'envoi et déconnecte les autres onglets

- Quoi : à la connexion d'un autre compte sur l'appareil (`activateOfflineUser`, `offline-storage.ts`), `purgeOthers(userId, { dropQueues: true })` supprime la copie de lecture ET la file d'envois en attente de chaque autre compte, et `session-changed` est diffusé : les autres onglets adoptent le nouveau compte (leur rejeu pour l'ancien s'arrête). La déconnexion fait de même pour tous les comptes (`purgeAll`, `dropOtherQueues: true`) et diffuse `logout`.
- Pourquoi : tablette ou téléphone partagé, un seul cookie : une file gardée pour un autre compte resterait illisible mais détruirait la garantie « rien d'un autre compte sur l'appareil ». Coût assumé : des écritures non synchronisées d'un autre compte sont perdues (journalisées : nombre et types, `clientLogger.warn`).
- Tester : `tests/unit/client/offline-storage-scope.test.ts` et `offline-resume-storage.test.ts`.
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

## 2026-11-10 18:00 - V5b-2b : audit sécurité et relecture (0aaaa7c2, fa78e0e5 et suite)

- Quoi : 0aaaa7c2 (livraison V5b-2b et garde de préfixe), fa78e0e5 (`routeExample` dans le test de barrière), puis CORS des en-têtes d'idempotence, route de l'envoi liée à son type, date de création par défaut, plafond 409 dérivé du délai de reprise serveur, abonnement `session-changed` testé, repli `AbortSignal.timeout`, test de rétention exact, prérequis d'allumage dans le plan.
- Comment et pourquoi : voir `docs/qa/journal/2026-11-10T1800-v5b-2b-audit-securite-suite.md`.
- Tester : tests unitaires `tests/unit/client/offline-*.test.ts` ; contrat `tests/contract/offline-owner-guard.contract.test.ts` sous verrou.

## 2026-11-10 18:45 - V5b-3b : restauration de la lecture hors ligne au démarrage

**Quoi.**
- Marqueur `offline-resume` (`client/src/lib/offline-resume.ts`) dans sa propre base IndexedDB `fleetos-offline-resume`, hors du préfixe des caches de lecture. Contenu : `version, userId, profile, lastOnlineAt, expiresAt, maxSeenAt, flags`. Aucun jeton, cookie, identifiant de session, email ni nom.
- Écrit après chaque `/api/auth/me` ou connexion réussis (`recordOfflineResume`), échéance repoussée seulement par une réponse RÉSEAU de `/api/feature-flags` ou `/api/auth/me` (`isContactProof`, `refreshOfflineResume`, au plus une fois par minute, tout de suite à l'arrivée des drapeaux). Une lecture quelconque ou une copie servie par IndexedDB ne prolonge rien. Jamais repoussée hors ligne.
- Démarrage : `session-check` « unreachable » sans `httpStatus` (réseau coupé ou délai, pas un 401/403/5xx) et aucun compte actif : `resumeOfflineRead` lit le marqueur, active le compte et restaure SA copie de lecture (marquée périmée). Lecture seule : la file d'envois n'est PAS rejouée tant que `/api/auth/me` n'a pas confirmé la session dans cette page (`isOfflineSessionConfirmed`, exigé par `replayOfflineQueue`, donc par tous les chemins de rejeu) ; aucun drapeau d'écriture touché.
- Profil : `OfflineReadProfile` gagne `roles` et `resumeOffline` (chauffeur oui, technicien non). Aucun `if role`.
- Purge du marqueur : déconnexion, changement d'utilisateur, 401 sur le `/me` du démarrage ET sur la vérification du propriétaire avant rejeu de la file (`checkOwner`), `session-changed` d'un autre onglet, `/me` d'un autre compte ou d'un rôle sans profil, expiration constatée, drapeau éteint reçu en ligne (suppression immédiate à l'écriture ou au rafraîchissement).
- Bandeau : « Hors ligne, données du X, session hors ligne jusqu'au Y ».

**Pourquoi.** Sans trace persistante de l'utilisateur actif, un démarrage sans réseau ne restaurait rien. Le cookie reste l'unique preuve d'identité ; le marqueur n'est qu'une autorisation locale bornée à 72 h après le dernier contact.

**Tester.** `node node_modules/vitest/vitest.mjs run tests/unit/client --reporter=dot` (fichiers `offline-resume*.test.ts`, `session-resume-offline.test.ts`, `session-check.test.ts`).

**Notes.** Le drapeau « offline-read » du brief n'existe pas : le marqueur garde `driver-offline` et `offline-writes`, tous deux requis. Après restauration, l'écran d'accueil attend encore `/me` (affichage du tableau de bord hors ligne : lot suivant).

**Suite (décision 0a, déconnexion sans réseau).**
- À la déconnexion, le marqueur est supprimé en premier (`purgeOfflineSession`, avant `postLogout`) : purge IndexedDB locale, indépendante du réseau.
- Si la suppression IndexedDB échoue : pierre tombale `fleetos-offline-resume-revoked` dans localStorage, contenu `{ userId }` seulement. Elle bloque toute restauration (`read`, `peek`, `touch`). Le démarrage suivant retente la purge du marqueur et lève la pierre si elle aboutit. Une connexion en ligne réussie (`record`) remplace le marqueur et lève aussi la pierre, y compris celle d'un autre compte. Même mécanisme sur 401.
- Tests : `offline-resume-storage.test.ts`, bloc « pierre tombale » (rouge constaté : 6 échecs sans le correctif, puis vert).

**Audit sécurité de 0a et relecture fonctionnelle (corrections).**
- C1 : un compte rouvert depuis le marqueur est « non confirmé » (`markOfflineSessionUnconfirmed` avant `setActiveOfflineUserId`). `replayOfflineQueue` refuse tout rejeu (événement `online`, écouteur de connexion, minuterie, bouton) tant que `/me` ou une connexion n'a pas appelé `activateOfflineUser` (confirmation, puis rattrapage du rejeu). Commentaire de `resumeOfflineRead` corrigé. Test : `offline-resume-replay.test.ts` (rouge : 2 échecs sans la garde).
- C2 : `checkSession` sépare le parse JSON du fetch : une 200 non JSON ou une redirection renvoie `unreachable` AVEC `httpStatus`, donc jamais de restauration.
- (a) Recul d'horloge : `maxSeenAt` ne fait que monter (contact réseau, lecture hors ligne), ne repousse jamais `expiresAt` ; refus si `now < maxSeenAt - 5 min`. Risque résiduel assumé : sans heure de confiance hors ligne, un recul avant la première lecture hors ligne suivant le dernier contact reste invisible ; il est borné par les 72 h de l'échéance, fixée par le dernier contact réseau.
- (b) Course avec le logout d'un autre onglet : compteur de génération relevé avant `offlineResume.read`, incrémenté par déconnexion, expiration et changement de compte ; la reprise s'abandonne s'il a bougé.
- (c) Double échec de purge : `purgeOfflineSession` renvoie faux si le marqueur ou les magasins n'ont pas pu être purgés ; `createLogout` garde alors le repère de déconnexion même si le POST réussit, et `resumeSession` le remet et ne restaure rien.
- (d) Bandeau : le marqueur doit appartenir au compte actif (`resumeDeadlineFor`) et l'échéance est appliquée par minuterie pendant que l'appli tourne. Le hook n'est pas rendu en test (pas de bibliothèque de rendu dans le dépôt) : la décision est pure et testée.
- Journal : déplacé de `docs/qa/journal/` vers ce fichier (la suite du lot V5b-2) ; `journal-fragments.test.ts` ne vérifie que le format des fragments, il n impose pas l emplacement.
