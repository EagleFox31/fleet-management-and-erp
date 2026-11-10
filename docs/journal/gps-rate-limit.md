# Journal : débit plafonné sur l'envoi des positions GPS du téléphone (#683)

## 2026-11-11 — Limiteur par chauffeur et par mission, propriétaire partagé, clé validée

Quoi :
- `POST /api/driver/missions/:id/positions` et `POST /api/driver/positions` étaient sans plafond.
- Un téléphone en boucle, ou un compte chauffeur volé, pouvait écrire sans limite dans `vehicle_positions`.
- Au-delà du plafond, la réponse est 429 `GPS_RATE_LIMITED` avec Retry-After. Le client garde le paquet en tampon (`shouldDropBatch(429) === false`) et le renvoie au vidage suivant : aucun point n'est perdu.

Comment :
- `server/middleware/keyed-rate-limit.ts` : seau à jetons par clé, Adapt de `auth-ip-limit.ts`.
  - Chaque requête consomme un jeton ; une requête refusée n'en consomme pas.
  - Mémoire bornée : les seaux pleins sont évincés d'abord, puis les moins récents.
- Paquets : la clé est `chauffeur:mission`. Rafale 20 (un tampon de 1 000 points envoyé par paquets de 50), puis un paquet toutes les 10 s.
- OsmAnd : la clé est le chauffeur. Rafale 30, puis un relevé toutes les 5 s.
- Réglages : `GPS_BATCH_BURST`, `GPS_BATCH_REFILL_SECONDS`, `GPS_OSMAND_BURST`, `GPS_OSMAND_REFILL_SECONDS`.
- `ownerHeaderMatches` / `offlineOwnerMismatch` (`server/lib/offline-owner.ts`) sont la source unique de la comparaison entre `X-Offline-Owner` et la session.
  - Partagés par `offlineOwnerGuard` et les routes GPS.
  - Un refus est journalisé `{ requestId }`, sans identifiant.
- Ordre : `jsonOnly` → `missionIdParam` → `ownerMatchesSession` → `batchRateLimit`. Un 400 ou un 409 ne consomme pas de jeton et ne crée pas de clé.

Réserve de relecture corrigée (sécurité) :
- La clé était construite avec l'id brut de l'URL, avant sa validation. Trois conséquences :
  - un id de 16 Ko × 10 000 clés occupait environ 160 Mo sur le VPS ;
  - un flot d'id distincts évinçait la vraie clé du chauffeur, ce qui remettait son quota à zéro ;
  - `07` contournait le quota de `7`.
- Correctif :
  - l'id est validé avant le limiteur (`routeIdSchema`, 400 sinon) ;
  - la clé prend l'id normalisé ;
  - une constante de repli garde la clé bornée si l'ordre des middlewares change.

Tester :
- Unitaire `keyed-rate-limit` : 6 tests ; la mutation `tokens < 0` en fait échouer 4.
- Unitaire `offline-owner` : 8 tests (forme valide, `" 7 "`, `"1, 2"`, vide) ; retirer le `$` de la regex fait échouer `"1, 2"`.
- Contrat `gps-phone-api` : 23 tests verts.
  - Rafale dépassée : 429, rien n'est écrit, une autre mission reste ouverte.
  - Id invalide : 400 sans clé créée.
  - `0<id>` : 429, quota partagé avec `<id>`.
- Rouge prouvé avec la clé brute : 4 clés créées par des id invalides.
- `npm run check:tests` lance le typecheck des tests, que `tsc -p .` ne couvre pas. Un faux `Request` (`Pick<Request,"get">`) y échouait sur la surcharge `set-cookie`. Correction : le type `HeaderReader`.

Reste : un contrat OsmAnd dédié au plafond (backlog).
