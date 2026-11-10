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
