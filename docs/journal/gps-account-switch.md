# GPS : changement de compte (S1), suite de #678

**Quoi** : l'époque de purge GPS avance à chaque changement de compte, les tampons des autres comptes sont détruits sans délai, `sendBuffered` reçoit l'époque de l'appelant, le paquet déclare son propriétaire et le serveur le vérifie.

**Comment** : `purgeGpsBuffersOfOthers(userId)` appelé par `activateOfflineUser` (donc aussi par le message `session-changed` d'un autre onglet) ; `sendBuffered(missionId, buffer, epoch, ownerUserId)` ; en-tête `X-Offline-Owner` et garde `ownerMatchesSession` sur `POST /api/driver/missions/:id/positions` (409 `OFFLINE_OWNER_MISMATCH`) ; entrée dans `docs/analysis/LESSONS_LEARNED.md`.

**Pourquoi** : audit sécurité de #678 : session de A expirée, panneau GPS de A ouvert, B se connecte dans un autre onglet, le flush de A partait avec le cookie de B.

**Tester** : `tests/unit/client/gps-account-switch.test.ts` (scénario A/B), `gps-tracking-buffer.test.ts`, contrat `gps-phone-api` (propriétaire déclaré).

## Suite : réouverture hors ligne, 409, hygiène des clés

**Quoi** : `resumeOfflineRead` appelle `purgeGpsBuffersOfOthers(grant.userId)` avant `setActiveOfflineUserId` (la réouverture depuis le marqueur contournait la purge faite par `activateOfflineUser`). Test du 409 `OFFLINE_OWNER_MISMATCH` (un seul envoi, tampon retiré, aucune réécriture). Test d'hygiène `tests/unit/client/user-keys-hygiene.test.ts`.

**Comment** : le test d'hygiène écrit des clés de A (tampons GPS et un brouillon par `formId` réellement déclaré dans le code), active B par `activateOfflineUser`, et exige que tout ce qui survit figure dans une liste gelée commentée (`FROZEN_UNPURGED`) ; la liste ne peut que diminuer (une règle qui ne retient plus rien fait échouer le test). Il classe aussi toute famille `fleetos-*` et tout fichier qui touche `localStorage` : un nouveau venu non classé échoue.

**Pourquoi** : la faille S1 s'est répétée trois fois (file hors ligne, tampon GPS, réouverture) ; la règle ne doit plus reposer sur la documentation. Liste gelée : les brouillons `fleetos-<form>-v<n>-<userId>` survivent à un changement de compte (purgés seulement à la déconnexion) ; les détruire ferait perdre sa saisie à qui se reconnecte, décision produit hors périmètre.

**Risque résiduel, onglet sans BroadcastChannel** : sans le canal, l'onglet ne reçoit pas `session-changed`. Les positions de A restent alors sur l'appareil jusqu'au prochain rejeu de B (`replayOrphanBuffers` détruit les tampons étrangers), mais elles ne peuvent pas partir : le paquet déclare son propriétaire (`X-Offline-Owner`), le serveur répond 409 `OFFLINE_OWNER_MISMATCH` et le client retire le paquet.

**Tester** : `node node_modules/vitest/vitest.mjs run tests/unit/client/gps-reopen-and-owner-mismatch.test.ts tests/unit/client/user-keys-hygiene.test.ts`.
