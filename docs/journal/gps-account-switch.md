# GPS : changement de compte (S1), suite de #678

**Quoi** : l'époque de purge GPS avance à chaque changement de compte, les tampons des autres comptes sont détruits sans délai, `sendBuffered` reçoit l'époque de l'appelant, le paquet déclare son propriétaire et le serveur le vérifie.

**Comment** : `purgeGpsBuffersOfOthers(userId)` appelé par `activateOfflineUser` (donc aussi par le message `session-changed` d'un autre onglet) ; `sendBuffered(missionId, buffer, epoch, ownerUserId)` ; en-tête `X-Offline-Owner` et garde `ownerMatchesSession` sur `POST /api/driver/missions/:id/positions` (409 `OFFLINE_OWNER_MISMATCH`) ; entrée dans `docs/analysis/LESSONS_LEARNED.md`.

**Pourquoi** : audit sécurité de #678 : session de A expirée, panneau GPS de A ouvert, B se connecte dans un autre onglet, le flush de A partait avec le cookie de B.

**Tester** : `tests/unit/client/gps-account-switch.test.ts` (scénario A/B), `gps-tracking-buffer.test.ts`, contrat `gps-phone-api` (propriétaire déclaré).
