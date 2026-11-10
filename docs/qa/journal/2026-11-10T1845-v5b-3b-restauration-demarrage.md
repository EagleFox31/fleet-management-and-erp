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
- Journal : conservé dans `docs/qa/journal/` (imposé par `tests/unit/docs/journal-fragments.test.ts` et le README du dossier), pas déplacé vers `docs/journal/`.
