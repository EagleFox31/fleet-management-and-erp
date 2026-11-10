# GPS : hygiène du tampon de positions

**Quoi** : purge des tampons d'autres comptes (même session expirée), époque de purge vérifiée par `sendBuffered` et le flush, fin de mission sans double lecture du tampon, plafond de points par mission en 409 `GPS_MISSION_CAP_REACHED` (définitif, non réessayé), faute de frappe de l'e2e 20.

**Comment** : `foreignBufferKeys` + purge des tampons expirés étrangers dans `replayOrphanBuffers` ; `sendBuffered` s'arrête si l'époque change ; `flushTrackingSession` exportée, verrou par clé pour que l'envoi final et le rejeu n'envoient pas deux fois ; `AppError(409, ..., { code })` côté serveur, code ajouté à `shared/errors.ts` et `errorHandling.ts`.

**Pourquoi** : réserves de l'audit sécurité de #668 : jamais de positions d'un compte sous l'identité d'un autre ; 429 était lu comme un ralentissement à réessayer alors que le plafond est définitif.

**Tester** : `node node_modules/vitest/vitest.mjs run tests/unit/client/gps-tracking-buffer.test.ts` ; contrat `gps-phone-api` avec `DATABASE_URL_TEST` local et `DATABASE_WS_PROXY=localhost:5433/v1`.
