## 2026-11-10 18:45 - V5b-3b : restauration de la lecture hors ligne au démarrage

**Quoi.**
- Marqueur `offline-resume` (`client/src/lib/offline-resume.ts`) dans sa propre base IndexedDB `fleetos-offline-resume`, hors du préfixe des caches de lecture. Contenu : `version, userId, profile, lastOnlineAt, expiresAt, flags`. Aucun jeton, cookie, identifiant de session, email ni nom.
- Écrit après chaque `/api/auth/me` ou connexion réussis (`recordOfflineResume`), échéance repoussée à chaque lecture réseau réussie du compte actif (`refreshOfflineResume`, au plus une fois par minute). Jamais repoussée hors ligne.
- Démarrage : `session-check` « unreachable » sans `httpStatus` (réseau coupé ou délai, pas un 401/403/5xx) et aucun compte actif : `resumeOfflineRead` lit le marqueur, active le compte et restaure SA copie de lecture (marquée périmée). Lecture seule : ni file d'envois ni drapeau d'écriture touchés.
- Profil : `OfflineReadProfile` gagne `roles` et `resumeOffline` (chauffeur oui, technicien non). Aucun `if role`.
- Purge du marqueur : déconnexion, changement d'utilisateur, 401, `session-changed` d'un autre onglet, `/me` d'un autre compte ou d'un rôle sans profil, expiration constatée, drapeaux éteints.
- Bandeau : « Hors ligne, données du X, session hors ligne jusqu'au Y ».

**Pourquoi.** Sans trace persistante de l'utilisateur actif, un démarrage sans réseau ne restaurait rien. Le cookie reste l'unique preuve d'identité ; le marqueur n'est qu'une autorisation locale bornée à 72 h après le dernier contact.

**Tester.** `node node_modules/vitest/vitest.mjs run tests/unit/client --reporter=dot` (fichiers `offline-resume*.test.ts`, `session-resume-offline.test.ts`, `session-check.test.ts`).

**Notes.** Le drapeau « offline-read » du brief n'existe pas : le marqueur garde `driver-offline` et `offline-writes`, tous deux requis. Après restauration, l'écran d'accueil attend encore `/me` (affichage du tableau de bord hors ligne : lot suivant).
