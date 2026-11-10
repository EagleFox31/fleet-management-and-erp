# Journal : moindre donnée sur les chemins carburant de server/routes.ts

## 2026-11-10 — Solde de la carte et agrégats carburant (lot de 0a)

Quoi : trois réponses d'écriture ne portent plus le solde de la carte (`balance`, `fuelBalance`) hors des lecteurs du trésor. Il s'agit de `POST /api/fuel-records`, de `PATCH /api/fuel-records/:id` et de `POST /api/fuel-records/:id/cancel`. Cela concerne surtout le chef d'atelier, qui saisit des pleins sans lire la trésorerie. `GET /api/fuel-records/statistics` est réservé à `FUEL_READ_ROLES` et au client. Le client reste cloisonné à ses véhicules par `ownerScopeOf` dans `routes.ts`. Chauffeur, technicien, magasinier et lecteur reçoivent 403.

Comment : `server/routes.ts` est gelé, donc rien n'y est ajouté. `server/api/fuel-records.routes.ts`, monté avant `registerRoutes`, déclare des gardes chaînées en relais pur `(_req, _res, next) => next()`, sur le modèle de `stock-valuation-guard.routes.ts`.
- POST et PATCH : `isFuelRecordWriter`, puis `maskFuelCardBalanceInResponse`. Ce dernier enveloppe `res.json` et applique `withoutFuelCardBalance(req.user, body)` au moment de l'envoi.
- Statistiques : `authorize([...FUEL_READ_ROLES, "client"])`.
- Annulation : la route est déjà dans ce routeur, la réponse passe par `withoutFuelCardBalance`.
- `server/lib/fuel-balance-scope.ts` est repris tel quel de #667 (pas encore fusionnée) ; le rebase suivra son arrivée sur main.
- `/api/exports/fuel` ne change pas : il est déjà masqué par `exportsGuard`, dont la matrice limite `fuel` à `FUEL_READERS` (preuve : `lot-exports-roles.contract.test.ts`).

Garde-fous :
- `routes-hygiene` : les trois chemins entrent dans `CHAINED_GUARD_ROUTES`.
- Le scan des lectures (`tests/support/route-guard-scan.ts`) reconnaît une poignée en relais pur (`isPassThroughGet`, forme stricte : un seul `next()` sans argument). Elle n'envoie rien ; la déclaration qui envoie la donnée est jugée seule.
- Des cas négatifs prouvent qu'un relais qui envoie, transmet un argument ou appelle autre chose reste refusé.
- Aucune liste gelée ne bouge : les routes de `routes.ts` restent servies et gardées.

Écrans vérifiés (git grep) :
- Les statistiques sont lues par le tableau de bord client (tuile « litres du mois ») et par le repli de `dashboard.tsx` pour un rôle inconnu.
- Aucun écran chauffeur, technicien, magasinier ou lecteur ne les lit.
- Les invalidations (admin, temps réel) ne lisent rien.

Pourquoi : le principe de moindre donnée. Le solde de la carte est une donnée de trésorerie (`TREASURY_FUEL_CARD_READ_ROLES`), et les agrégats de flotte sont une donnée de pilotage.

Tester :
- Base de test dédiée, Postgres local (`fleet_test_de_fuel`), jamais Neon :
  `DATABASE_URL_TEST=postgres://fleet:fleet@postgres:5432/fleet_test_de_fuel DATABASE_WS_PROXY=127.0.0.1:56433/v1 node --preserve-symlinks node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/fuel-records-least-data.contract.test.ts`
- Rouge avant le correctif : 7 échecs sur 14 (solde présent pour le chef d'atelier sur les 3 chemins ; 200 au lieu de 403 pour les 4 rôles).
- Vert après : 14 sur 14.

Piège : dans un worktree dont `node_modules` est une jonction, vitest charge deux copies de son runner (chemin de la jonction et chemin réel). Le résultat est « Vitest failed to find the current suite » dès le fichier d'installation. La parade : `node --preserve-symlinks`, lancé depuis `C:/…` (lettre de lecteur en capitale).

## 2026-11-11 — Champs de mission des pleins : le chauffeur limité à ses missions (suivi de #686)

Quoi :
- #686 masque `orderNumber`, `clientName` et `destination` hors `MISSION_READ_ROLES`.
- Le chauffeur est dans cette liste et lisait donc ces champs sur les pleins de toute la flotte.
- Il ne les lit plus que sur les pleins de SES missions.

Comment :
- `driverMissionIdsOf(reader)` (`server/lib/driver-scope.ts`) : les missions où l'une de ses fiches a une affectation vivante (`driverLiveAssignmentFilter`). C'est la même règle que la lecture des missions : une affectation annulée ou refusée ne compte pas, une affectation terminée compte.
- `presentFuelRecords(reader, value, ownMissionIds)` : pour le chauffeur, les champs restent si `missionId` appartient à cet ensemble. Ils sont masqués sinon, et aussi sans ensemble fourni (échec fermé).
- Les deux GET (`/fuel-records`, `/fuel-records/vehicle/:id`) passent l'ensemble. Il vaut `undefined` hors chauffeur et ne coûte alors aucune requête.

Contrats ajoutés (`fuel-records-least-data.contract.test.ts`) :
- client, sur ses véhicules, par les 3 chemins : champs absents ;
- rôle stocké hors liste : champs servis exactement comme la lecture des missions (voir le constat ci-dessous) ;
- garde-fou : les rôles hors `MISSION_READ_ROLES` sont `client` et `technician`. Un nouveau rôle hors liste oblige à revoir ce contrat ;
- chauffeur : sa mission, champs lus ; la mission d'un autre, champs masqués ; affectation annulée, champs masqués.

Constat (non traité ici) :
- `normalizeRole` lit un rôle inconnu comme `user`, qui est un rôle du personnel, donc dans `MISSION_READ_ROLES`.
- `users.role` est en `text` côté Drizzle, sans pgEnum : une valeur hors liste s'écrit en base (prouvé en local).
- Décision de 0a : un rôle inconnu sera fermé (403), dans une PR séparée.

Tester :
- Rouge, mutation `return true` pour le chauffeur dans `fuel-record-scope.ts` : 1 échec sur 20, la mission d'un autre fuit `orderNumber`.
- Vert : 20 sur 20. Unitaire `fuel-record-scope` : 10 sur 10.
- Base : `fleet_test` local (56432/56433).
