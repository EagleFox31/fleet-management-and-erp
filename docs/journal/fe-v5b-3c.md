# Journal fe-v5b-3c

## 2026-11-10 - V5b-3c : tableau chauffeur en lecture seule après reprise hors ligne

**Quoi.** Quand `/api/auth/me` est injoignable et que la lecture hors ligne se rouvre (3b), l'application affiche le tableau chauffeur en consultation seule, avec un bandeau « Hors ligne. Données du <date heure>. Consultation seule jusqu'au <date heure>. », au lieu du voile `session-unreachable`. `user` reste `null` : aucun faux utilisateur, aucun rôle reconstruit.

**Comment.**
- `session-check.ts` : `SessionCheck.unreachable` porte un champ optionnel `resumed` (`OfflineGrantInfo` : `userId`, `profile`, `expiresAt`), pas de nouveau statut. `session-resume.ts` le renseigne seulement si `restoreOffline` a réussi (il renvoie le grant ou `null`).
- `offline-storage.ts` (`resumeOfflineRead`) vérifie avant tout que `grant.userId` est propriétaire du cache cloisonné (`offline-user-scope.ts`, `cacheOwnership` : enveloppe du magasin `fleetos-offline-u<id>` et absence de copie de lecture d'un autre compte). Écart : purge locale complète, aucun grant, donc voile.
- `auth-bootstrap.ts` (logique pure, sans React, testable) porte la boucle `resumeSession` + backoff, la reprise (`offlineGrant`), l'échéance (minuteur + contrôle à chaque tour, puis `expireOfflineSession` : cache TanStack vidé, copie de lecture supprimée) et le 401 (purge, écran de connexion). `useAuth` recopie cet état.
- `offline-read-only.ts` + `useOfflineReadOnly()` : source unique de la règle `!user && offlineGrant`. `OfflineShellGate` (dans `App.tsx`) ne monte que l'accueil du profil du grant (table profil vers accueil : chauffeur vers `/`) et redirige toute autre URL ; il lit le profil, jamais un rôle.
- `driver/dashboard.tsx` : le CTA de statut, le panneau GPS, le rejeu GPS, le plein, le dépôt POD, le signalement et leurs feuilles lisent `readOnly`. Onglets, déconnexion et aide portent `data-read-only-safe`.

**Pourquoi.** La restauration de 3b était invisible : `useAuth` restait en `isLoading` sans utilisateur. Un chauffeur sans réseau doit relire sa mission, sans pouvoir écrire au nom d'un compte que le serveur n'a pas confirmé.

**Tester.** `tests/unit/client/auth-bootstrap.test.ts` (grant sans voile, /me, 401, échéance), `session-resume-offline.test.ts` (grant seulement si restauré), `offline-resume-storage.test.ts` (propriétaire du cache), `driver-dashboard-read-only.test.ts` (parcours générique des boutons actifs), `offline-resume-banner.test.ts`. e2e : `e2e/21-driver-offline-resume.spec.ts` (voir l'entrée suivante).

## Risque d'horloge assumé (reliquat 4 de #671)

- Quoi : la borne de 72 h de la reprise hors ligne se mesure en heure de l'appareil. Reculer l'horloge, ou la ramener à chaque démarrage à moins de 5 minutes de `maxSeenAt`, prolonge la lecture au-delà de 72 h réelles.
- Pourquoi : hors ligne il n'existe aucune heure de confiance. Risque assumé : la lecture ne donne que la copie locale du compte, et `/api/auth/me` (cookie) revalide au retour du réseau.
- Comment : commentaire de `CLOCK_SKEW_MS` dans `client/src/lib/offline-resume.ts` corrigé ; le comportement est figé par un test.
- Tester : `node node_modules/vitest/vitest.mjs run tests/unit/client/offline-resume.test.ts` (cas « risque assumé »).

## V5b-3c : e2e 21 sur build avec service worker

- Quoi : `e2e/21-driver-offline-resume.spec.ts`, 4 cas : rechargement sous `context.setOffline(true)` (tableau, bandeau « Consultation seule », zéro bouton d'écriture, pas de voile, autre URL renvoyée à l'accueil, retour du réseau qui rend les écritures), déconnexion puis rechargement hors ligne (rien du compte lisible), marqueur expiré (`page.clock` à +73 h : pas de reprise, voile), rôle sans reprise (chef d'atelier : voile, aucun tableau).
- Comment : `vite build` + bundle serveur, serveur de production local sur le port 5050 (`APP_URL` en http pour le cookie), base locale dédiée `fleet_test_v5b3c` (Postgres fm-pod, schéma poussé par drizzle-kit), `FEATURE_FLAGS=driver-offline=on,offline-writes=on`, `E2E_BASE_URL=http://127.0.0.1:5050`. Le spec est ignoré sans `E2E_BASE_URL` : une variante dev avec `page.route` ne prouve rien du service worker.
- Pourquoi : la reprise hors ligne dépend de ce que le service worker sert au rechargement ; seul un build de production l'enregistre.
- Constats : (1) seules les missions `in_progress` et `delivered` sont lisibles hors ligne (décision 3 de V5b) : une mission `assigned` donne « Aucune mission assignée » ; (2) les ressources chargées avant la prise de contrôle du service worker ne sont pas dans son cache : le spec recharge une fois en ligne avant de couper le réseau, sinon le rechargement hors ligne reste blanc (comportement de la coquille, hors périmètre 3c).
- Tester : `npm run build`, serveur de production avec les variables ci-dessus, puis `E2E_SKIP_ACCOUNT_CHECK=1 E2E_BASE_URL=http://127.0.0.1:5050 DATABASE_URL=... node node_modules/@playwright/test/cli.js test e2e/21-driver-offline-resume.spec.ts` (écritures sous `node ../lot-tools/db-lock.mjs`).
