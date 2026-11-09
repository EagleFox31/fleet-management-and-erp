## 2026-11-04 14:39 — Lot atomique : réservation de la tentative avant la vérification du secret, limite par IP

- **Quoi** : la garde par compte (`pwd:`, `pin:`, `cpw:`) réserve la tentative avant le handler, sous un verrou consultatif par clé. Elle refuse en 503 si le compteur est en panne. Un plafond d'échecs par IP est ajouté devant `/api/auth/login` et `/api/auth/pin-login`.
- **Comment** :
  - garde par compte : 401 → échec confirmé ; 2xx → remise à zéro ; 400 ou 5xx → tentative rendue ;
  - limite IP : seuls un 2xx ou un 400 rendent leur jeton, une 5xx reste comptée (filet anti-abus, décision de 0a).
- **Pourquoi** : lire, laisser passer, puis écrire après le bcrypt laissait une rafale simultanée vérifier plus de secrets que le seuil (voir LESSONS, « Compteur anti-force brute lu puis écrit en deux temps »).
- **Audit sécurité** : GO sous réserve.
  - R1 (garde ouverte sur panne) et m6 (connexion cassée rendue au pool) sont corrigés dans ce lot.
  - R2 (validation du corps de `/auth/login` avant la garde, dans `server/api/index.ts`), m3 (agrégation IPv6 par /64), m4 (seuil derrière un NAT) et m5 (taille de la section critique) sont remontés à l'orchestrateur.
- **Preuves** :
  - contrat `login-lockout-concurrency` : rafales sur les trois espaces et sur la limite IP ;
  - intégration `login-lockout-db-store` : 20 réservations parallèles, exactement MAX admises, un seul audit ;
  - unitaires `auth-ip-limit` : 9/9.

